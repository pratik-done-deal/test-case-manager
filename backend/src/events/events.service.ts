import { BeforeApplicationShutdown, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Client } from 'pg';
import { Subject } from 'rxjs';
import { DataSource } from 'typeorm';

// automation: which test cases have tests changed. runs: a run queued, moved on or ended.
// logins: a login window opened or closed, or a session was saved. runners: a runner came or went.
export type ChangeEvent = 'catalog' | 'results' | 'automation' | 'runs' | 'logins' | 'runners';
const EVENTS: ChangeEvent[] = ['catalog', 'results', 'automation', 'runs', 'logins', 'runners'];

const CHANNEL = 'tm_events';
const RETRY_MS = [1000, 2000, 5000, 10_000, 30_000];

// Tells open pages that something changed, so they refetch it without waiting for their next poll.
// Changes go through Postgres NOTIFY, so pages connected to any backend instance hear about them.
@Injectable()
export class EventsService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(EventsService.name);
  readonly changes = new Subject<ChangeEvent>();
  // Fires when the backend shuts down. Open event streams end then: the server only closes once every
  // connection has, and a page left open would otherwise keep it (and a dev reload) waiting forever.
  readonly closing = new Subject<void>();
  private listener: Client | null = null;
  private stopped = false;
  private attempt = 0;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async onApplicationBootstrap() {
    await this.listen();
  }

  async beforeApplicationShutdown() {
    this.stopped = true;
    this.closing.next();
    this.closing.complete();
    await this.listener?.end().catch(() => undefined);
  }

  // Without a listener (Postgres unreachable for a moment), at least this instance's pages hear it.
  emit(event: ChangeEvent) {
    if (!this.listener) {
      this.changes.next(event);
      return;
    }
    this.dataSource.query('SELECT pg_notify($1, $2)', [CHANNEL, event]).catch(() => this.changes.next(event));
  }

  private async listen() {
    const client = new Client({ connectionString: process.env.DATABASE_URL ?? 'postgres://localhost:5432/test_manager' });
    client.on('notification', ({ payload }) => {
      if (EVENTS.includes(payload as ChangeEvent)) this.changes.next(payload as ChangeEvent);
    });
    client.on('error', (error) => this.logger.error(`Event listener: ${error.message}`));
    client.on('end', () => {
      if (this.listener === client) this.listener = null;
      this.retry();
    });
    try {
      await client.connect();
      await client.query(`LISTEN ${CHANNEL}`);
      this.listener = client;
      // Changes made while it was away were missed: every page refetches everything.
      if (this.attempt > 0) EVENTS.forEach((event) => this.changes.next(event));
      this.attempt = 0;
    } catch (error) {
      this.logger.error(`Could not listen for changes: ${error instanceof Error ? error.message : String(error)}`);
      await client.end().catch(() => undefined);
      this.retry();
    }
  }

  private retry() {
    if (this.stopped) return;
    const wait = RETRY_MS[Math.min(this.attempt++, RETRY_MS.length - 1)];
    setTimeout(() => void this.listen(), wait).unref();
  }
}
