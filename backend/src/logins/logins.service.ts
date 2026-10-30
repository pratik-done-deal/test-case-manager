import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ChildProcess, execFile, spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { EventsService } from '../events/events.service';
import { aiQaDir, aiQaPython } from '../runs/test-index.service';

// The roles the app offers, as ai-qa's scripts/save_auth_state.py names them.
export const ROLES = ['buyer', 'seller', 'admin', 'biz_user'] as const;
export type Role = (typeof ROLES)[number];

// waiting: the login browser is open. saving: Save was pressed. saved / failed / cancelled: it ended.
type Status = 'waiting' | 'saving' | 'saved' | 'failed' | 'cancelled';

type Login = { role: Role; child: ChildProcess; status: Status; message: string | null; output: string };

// Where ai-qa keeps each role's session for the app it points at (settings decide QA or local).
const PATHS_SCRIPT = `
import json
from utils.sessions import LOGIN_PATHS, STATE_BY_ROLE
from config import settings
print(json.dumps({"app": settings.app_url, "states": {r: str(p) for r, p in STATE_BY_ROLE.items()},
                  "logins": LOGIN_PATHS}))
`;

// Saves a role's login for the test suite the same way as `python scripts/save_auth_state.py <role>`:
// it runs that script, which opens a browser at the role's login page, and presses its Enter when the
// tester clicks Save in the app.
@Injectable()
export class LoginsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(LoginsService.name);
  private readonly logins = new Map<Role, Login>();
  private paths: { app: string; states: Record<string, string>; logins: Record<string, string> } | null = null;
  private reason: string | null = 'Not ready yet';

  constructor(private readonly events: EventsService) {}

  async onApplicationBootstrap() {
    const dir = aiQaDir();
    if (!dir || !existsSync(join(dir, 'scripts', 'save_auth_state.py'))) {
      this.reason = 'The backend cannot see the ai-qa checkout (set AI_QA_DIR)';
      return;
    }
    if (!existsSync(aiQaPython(dir))) {
      this.reason = `No Python at ${aiQaPython(dir)} (set AI_QA_PYTHON)`;
      return;
    }
    await this.readPaths();
  }

  onModuleDestroy() {
    for (const login of this.logins.values()) login.child.kill();
  }

  private readPaths() {
    const dir = aiQaDir()!;
    return new Promise<void>((done) =>
      execFile(aiQaPython(dir), ['-c', PATHS_SCRIPT], { cwd: dir }, (error, stdout, stderr) => {
        try {
          this.paths = JSON.parse(stdout.trim().split('\n').pop() ?? '');
          this.reason = null;
        } catch {
          this.reason = `Could not read ai-qa's session settings: ${stderr.trim() || error?.message}`;
          this.logger.error(this.reason);
        }
        done();
      }),
    );
  }

  // Each role's saved session and any login going on for it.
  list() {
    const roles = ROLES.map((role) => {
      const file = this.paths?.states[role];
      const savedAt = file && existsSync(file) ? statSync(file).mtime : null;
      const login = this.logins.get(role);
      return {
        role,
        savedAt,
        loginUrl: this.paths ? new URL(this.paths.logins[role], this.paths.app).toString() : null,
        login: login ? { status: login.status, message: login.message } : null,
      };
    });
    return { available: !this.reason, reason: this.reason, app: this.paths?.app ?? null, roles };
  }

  start(role: Role) {
    if (this.reason) throw new ServiceUnavailableException(this.reason);
    const going = this.logins.get(role);
    if (going && (going.status === 'waiting' || going.status === 'saving')) {
      throw new ConflictException(`A ${role} login window is already open`);
    }
    const dir = aiQaDir()!;
    const child = spawn(aiQaPython(dir), ['scripts/save_auth_state.py', role], {
      cwd: dir,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const login: Login = { role, child, status: 'waiting', message: null, output: '' };
    this.logins.set(role, login);

    const read = (chunk: Buffer) => {
      login.output = (login.output + chunk.toString()).slice(-20_000);
      // The script refuses a biz_user login that isn't a business user, and waits for another try.
      const refused = /Session not saved: ([^\n]*)/.exec(chunk.toString());
      if (refused && login.status === 'saving') {
        login.status = 'waiting';
        login.message = refused[1].trim();
        this.events.emit('logins');
      }
    };
    child.stdout!.on('data', read);
    child.stderr!.on('data', read);
    child.on('error', (error) => {
      login.output += `\n${error.message}`;
    });
    child.on('close', (code) => {
      if (login.status === 'cancelled') {
        login.message = null;
      } else if (code === 0 && /Saved \w+ session/.test(login.output)) {
        login.status = 'saved';
        login.message = null;
      } else {
        login.status = 'failed';
        login.message = this.failure(login.output);
      }
      this.logger.log(`${role} login ${login.status}`);
      this.events.emit('logins');
    });

    this.logger.log(`${role} login window opened`);
    this.events.emit('logins');
    return this.list();
  }

  // The Enter the script waits for, once the tester has logged in in its browser.
  save(role: Role) {
    const login = this.going(role);
    if (login.status !== 'waiting') throw new BadRequestException('Already saving');
    login.status = 'saving';
    login.message = null;
    login.child.stdin!.write('\n');
    this.events.emit('logins');
    return this.list();
  }

  cancel(role: Role) {
    const login = this.going(role);
    login.status = 'cancelled';
    login.child.kill();
    this.events.emit('logins');
    return this.list();
  }

  private going(role: Role) {
    const login = this.logins.get(role);
    if (!login || (login.status !== 'waiting' && login.status !== 'saving')) {
      throw new NotFoundException(`No ${role} login window is open`);
    }
    return login;
  }

  // The line that says why the script stopped; a closed browser is the usual one.
  private failure(output: string) {
    if (/Target page, context or browser has been closed|Browser closed|has been closed/i.test(output)) {
      return 'The login browser was closed before the session was saved';
    }
    const lines = output.trim().split('\n').filter(Boolean);
    return lines.at(-1)?.slice(0, 300) ?? 'The login script stopped';
  }
}
