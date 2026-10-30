import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { EventsService } from '../events/events.service';
import type { CollectedTest } from '../runs/match-tests';
import type { RunEnvironment } from '../runs/run.entity';
import { environmentKey } from '../runs/environment';
import { RunsService } from '../runs/runs.service';
import { isOnline } from './online';
import { Runner, type RunnerLogins } from './runner.entity';

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
    await this.dataSource.query(
      `INSERT INTO runners (id, name, environment, logins, last_seen_at, tests, commands)
       VALUES (?, ?, ?, ?, ?, '[]', '[]')
       ON DUPLICATE KEY UPDATE
         environment = VALUES(environment), logins = VALUES(logins), last_seen_at = VALUES(last_seen_at), commands = '[]'`,
      [randomUUID(), name, environment && JSON.stringify(environment), logins && JSON.stringify(logins), new Date()],
    );
    const runner = await this.runners.findOneOrFail({ where: { name }, select: { id: true } });
    this.events.emit('runners');
    this.events.emit('logins');
    return { id: runner.id };
  }

  async setTests(id: string, tests: CollectedTest[], reason: string | null, environment: RunEnvironment | null) {
    await this.get(id);
    await this.runners.update(id, {
      tests: reason ? [] : tests,
      testsReason: reason,
      testsAt: new Date(),
      lastSeenAt: new Date(),
      ...(environment ? { environment } : {}),
    });
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
    const row = await this.dataSource.transaction(async (manager) => {
      const runner = await manager.findOne(Runner, {
        where: { id },
        select: { id: true, commands: true, lastSeenAt: true },
        lock: { mode: 'pessimistic_write' },
      });
      if (runner) await manager.update(Runner, id, { commands: [], lastSeenAt: new Date() });
      return runner;
    });
    if (!row) throw new NotFoundException('Unknown runner; say hello first');
    // Back after being offline: pages showing it as offline refresh.
    if (!isOnline(row)) this.events.emit('runners');
    return { commands: row.commands, run: await this.runs.claim(id) };
  }

  async get(id: string) {
    const runner = await this.runners.findOneBy({ id });
    if (!runner) throw new NotFoundException('Unknown runner; say hello first');
    return runner;
  }
}
