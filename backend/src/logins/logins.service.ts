import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { EventsService } from '../events/events.service';
import { isOnline } from '../runners/online';
import { ROLES, Runner, type Role, type RunnerCommand, type RunnerLogins } from '../runners/runner.entity';

export { ROLES, type Role };

// Saves a role's login for the test suite on a runner's laptop, the same way as
// `python scripts/save_auth_state.py <role>` there: the runner opens a browser at the role's login page,
// and presses its Enter when the tester clicks Save in the app. This only passes the clicks on and shows
// what the runner reports.
@Injectable()
export class LoginsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Runner) private readonly runners: Repository<Runner>,
    private readonly events: EventsService,
  ) {}

  // Each role's saved session on the runner and any login going on for it.
  async list(runnerId: string | undefined): Promise<RunnerLogins> {
    const unavailable = (reason: string): RunnerLogins => ({
      available: false,
      reason,
      app: null,
      roles: ROLES.map((role) => ({ role, savedAt: null, loginUrl: null, login: null })),
    });
    if (!runnerId) return unavailable('Pick the laptop that runs the tests');
    const runner = await this.runners.findOneBy({ id: runnerId });
    if (!runner) return unavailable('That runner is no longer registered');
    if (!runner.logins) return unavailable(`${runner.name} has not reported its logins yet`);
    if (!isOnline(runner)) return { ...runner.logins, available: false, reason: `${runner.name} is offline` };
    return runner.logins;
  }

  async start(runnerId: string, role: Role) {
    const runner = await this.ready(runnerId);
    const going = this.window(runner, role);
    if (going && (going.status === 'waiting' || going.status === 'saving')) {
      throw new ConflictException(`A ${role} login window is already open`);
    }
    return this.send(runner, { kind: 'login', role });
  }

  // The Enter the script waits for, once the tester has logged in in its browser.
  async save(runnerId: string, role: Role) {
    const runner = await this.ready(runnerId);
    const going = this.open(runner, role);
    if (going.status !== 'waiting') throw new BadRequestException('Already saving');
    return this.send(runner, { kind: 'save', role });
  }

  async cancel(runnerId: string, role: Role) {
    const runner = await this.ready(runnerId);
    this.open(runner, role);
    return this.send(runner, { kind: 'cancel', role });
  }

  private async ready(runnerId: string) {
    const runner = await this.runners.findOneBy({ id: runnerId });
    if (!runner) throw new NotFoundException('That runner is no longer registered');
    if (!isOnline(runner)) throw new ServiceUnavailableException(`${runner.name} is offline; start its runner agent`);
    if (runner.logins && !runner.logins.available) throw new ServiceUnavailableException(runner.logins.reason);
    return runner;
  }

  private window(runner: Runner, role: Role) {
    return runner.logins?.roles.find((entry) => entry.role === role)?.login ?? null;
  }

  private open(runner: Runner, role: Role) {
    const login = this.window(runner, role);
    if (!login || (login.status !== 'waiting' && login.status !== 'saving')) {
      throw new NotFoundException(`No ${role} login window is open`);
    }
    return login;
  }

  // Queues the command for the runner's next poll, a couple of seconds away.
  private async send(runner: Runner, command: RunnerCommand) {
    await this.dataSource.query(`UPDATE runners SET commands = commands || $2::jsonb WHERE id = $1`, [
      runner.id,
      JSON.stringify([command]),
    ]);
    this.events.emit('logins');
    return this.list(runner.id);
  }
}
