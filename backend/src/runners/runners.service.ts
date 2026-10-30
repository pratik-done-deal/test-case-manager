import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { EventsService } from '../events/events.service';
import type { CollectedTest } from '../runs/match-tests';
import type { RunEnvironment } from '../runs/run.entity';
import { environmentKey } from '../runs/environment';
import { RunsService } from '../runs/runs.service';
import { isOnline } from './online';
import { Runner, type RunnerCommand, type RunnerLogins } from './runner.entity';

// The runner agents on testers' laptops: who they are, what they collected, and what they are asked to do.
@Injectable()
export class RunnersService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Runner) private readonly runners: Repository<Runner>,
    private readonly runs: RunsService,
    private readonly events: EventsService,
  ) {}

  // Every runner, online ones first, for the app's runner picker.
  async list() {
    const rows = await this.runners.find({ order: { name: 'ASC' } });
    return rows
      .map((runner) => ({
        id: runner.id,
        name: runner.name,
        online: isOnline(runner),
        lastSeenAt: runner.lastSeenAt,
        environment: runner.environment,
        environmentKey: environmentKey(runner.environment?.appUrl),
        tests: runner.tests.length,
        testsReason: runner.testsReason,
      }))
      .sort((a, b) => Number(b.online) - Number(a.online));
  }

  // A runner starting up: registered by name, so a restarted agent keeps its id and run history.
  async hello(name: string, environment: RunEnvironment | null, logins: RunnerLogins | null) {
    const rows = await this.dataSource.query(
      `INSERT INTO runners (name, environment, logins, last_seen_at, commands)
       VALUES ($1, $2, $3, now(), '[]')
       ON CONFLICT (name) DO UPDATE
         SET environment = EXCLUDED.environment, logins = EXCLUDED.logins, last_seen_at = now(), commands = '[]'
       RETURNING id`,
      [name, environment && JSON.stringify(environment), logins && JSON.stringify(logins)],
    );
    this.events.emit('runners');
    this.events.emit('logins');
    return { id: (rows as { id: string }[])[0].id };
  }

  async setTests(id: string, tests: CollectedTest[], reason: string | null) {
    await this.get(id);
    await this.runners.update(id, { tests: reason ? [] : tests, testsReason: reason, testsAt: new Date(), lastSeenAt: new Date() });
    this.events.emit('automation');
    this.events.emit('runners');
  }

  async setLogins(id: string, logins: RunnerLogins) {
    await this.get(id);
    await this.runners.update(id, { logins, lastSeenAt: new Date() });
    this.events.emit('logins');
  }

  // The runner checking in: hands it the login commands waiting for it and its next queued run.
  async poll(id: string) {
    const [rows] = await this.dataSource.query(
      `UPDATE runners r SET commands = '[]', last_seen_at = now()
       FROM (SELECT id, commands, last_seen_at FROM runners WHERE id = $1 FOR UPDATE) old
       WHERE r.id = old.id
       RETURNING old.commands, old.last_seen_at`,
      [id],
    );
    const row = (rows as { commands: RunnerCommand[]; last_seen_at: Date }[])[0];
    if (!row) throw new NotFoundException('Unknown runner; say hello first');
    // Back after being offline: pages showing it as offline refresh.
    if (!isOnline({ lastSeenAt: new Date(row.last_seen_at) })) this.events.emit('runners');
    return { commands: row.commands, run: await this.runs.claim(id) };
  }

  async get(id: string) {
    const runner = await this.runners.findOneBy({ id });
    if (!runner) throw new NotFoundException('Unknown runner; say hello first');
    return runner;
  }
}
