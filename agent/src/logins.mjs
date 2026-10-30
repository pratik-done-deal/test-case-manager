import { execFile, spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.mjs';

// The roles the app offers, as ai-qa's scripts/save_auth_state.py names them.
const ROLES = ['buyer', 'seller', 'admin', 'biz_user'];

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
// tester clicks Save in the app. onChange is called with the new state whenever it changes.
export class Logins {
  constructor(onChange) {
    this.onChange = onChange;
    this.windows = new Map(); // role -> { child, status, message, output }
    this.paths = null;
    this.reason = 'Not ready yet';
  }

  async init() {
    if (!existsSync(join(config.aiQaDir, 'scripts', 'save_auth_state.py'))) {
      this.reason = `No scripts/save_auth_state.py in ${config.aiQaDir} (check AI_QA_DIR)`;
      return;
    }
    if (!existsSync(config.python)) {
      this.reason = `No Python at ${config.python} (set AI_QA_PYTHON)`;
      return;
    }
    await new Promise((done) =>
      execFile(config.python, ['-c', PATHS_SCRIPT], { cwd: config.aiQaDir }, (error, stdout, stderr) => {
        try {
          this.paths = JSON.parse(stdout.trim().split('\n').pop() ?? '');
          this.reason = null;
        } catch {
          this.reason = `Could not read ai-qa's session settings: ${stderr.trim() || error?.message}`;
          console.error(this.reason);
        }
        done();
      }),
    );
  }

  // Each role's saved session and any login going on for it, as the app shows it.
  state() {
    const roles = ROLES.map((role) => {
      const file = this.paths?.states[role];
      const savedAt = file && existsSync(file) ? statSync(file).mtime.toISOString() : null;
      const login = this.windows.get(role);
      return {
        role,
        savedAt,
        loginUrl: this.paths ? new URL(this.paths.logins[role], this.paths.app).toString() : null,
        login: login ? { status: login.status, message: login.message } : null,
      };
    });
    return { available: !this.reason, reason: this.reason, app: this.paths?.app ?? null, roles };
  }

  // A command from the app: open a login window, save it or cancel it.
  handle({ kind, role }) {
    if (!ROLES.includes(role) || this.reason) return;
    if (kind === 'login') this.start(role);
    else if (kind === 'save') this.save(role);
    else if (kind === 'cancel') this.cancel(role);
  }

  closeAll() {
    for (const login of this.windows.values()) login.child.kill();
  }

  start(role) {
    const going = this.windows.get(role);
    if (going && (going.status === 'waiting' || going.status === 'saving')) return;
    const child = spawn(config.python, ['scripts/save_auth_state.py', role], {
      cwd: config.aiQaDir,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const login = { child, status: 'waiting', message: null, output: '' };
    this.windows.set(role, login);

    const read = (chunk) => {
      login.output = (login.output + chunk.toString()).slice(-20_000);
      // The script refuses a biz_user login that isn't a business user, and waits for another try.
      const refused = /Session not saved: ([^\n]*)/.exec(chunk.toString());
      if (refused && login.status === 'saving') {
        login.status = 'waiting';
        login.message = refused[1].trim();
        this.onChange();
      }
    };
    child.stdout.on('data', read);
    child.stderr.on('data', read);
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
        login.message = failure(login.output);
      }
      console.log(`${role} login ${login.status}`);
      this.onChange();
    });

    console.log(`${role} login window opened`);
    this.onChange();
  }

  // The Enter the script waits for, once the tester has logged in in its browser.
  save(role) {
    const login = this.windows.get(role);
    if (!login || login.status !== 'waiting') return;
    login.status = 'saving';
    login.message = null;
    login.child.stdin.write('\n');
    this.onChange();
  }

  cancel(role) {
    const login = this.windows.get(role);
    if (!login || (login.status !== 'waiting' && login.status !== 'saving')) return;
    login.status = 'cancelled';
    login.child.kill();
    this.onChange();
  }
}

// The line that says why the script stopped; a closed browser is the usual one.
function failure(output) {
  if (/Target page, context or browser has been closed|Browser closed|has been closed/i.test(output)) {
    return 'The login browser was closed before the session was saved';
  }
  const lines = output.trim().split('\n').filter(Boolean);
  return lines.at(-1)?.slice(0, 300) ?? 'The login script stopped';
}
