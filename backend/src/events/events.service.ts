import { BeforeApplicationShutdown, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Subject } from 'rxjs';
import { DataSource } from 'typeorm';

// automation: which test cases have tests changed. runs: a run queued, moved on or ended.
// logins: a login window opened or closed, or a session was saved. runners: a runner came or went.
export type ChangeEvent = 'catalog' | 'results' | 'automation' | 'runs' | 'logins' | 'runners';
const EVENTS: ChangeEvent[] = ['catalog', 'results', 'automation', 'runs', 'logins', 'runners'];

// How often each instance looks for changes made by the others.
const POLL_MS = 1000;
// Changes are only needed until every instance has read them.
const KEEP_MS = 10 * 60_000;
const PRUNE_MS = 60_000;

// Tells open pages that something changed, so they refetch it without waiting for their next poll.
// Pages connected to this instance hear its changes at once; every change is also written to the
// change_events table, which each instance reads every second, so pages connected to any backend
// instance hear about changes made on the others.
@Injectable()
export class EventsService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(EventsService.name);
  readonly changes = new Subject<ChangeEvent>();
  // Fires when the backend shuts down. Open event streams end then: the server only closes once every
  // connection has, and a page left open would otherwise keep it (and a dev reload) waiting forever.
  readonly closing = new Subject<void>();
  private readonly origin = randomUUID();
  private lastId = 0;
  private reading = false;
  private failing = false;
  private poller?: NodeJS.Timeout;
  private pruner?: NodeJS.Timeout;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async onApplicationBootstrap() {
    const [row] = await this.dataSource.query('SELECT COALESCE(MAX(id), 0) AS id FROM change_events');
    this.lastId = Number(row.id);
    this.poller = setInterval(() => void this.read(), POLL_MS);
    this.pruner = setInterval(() => void this.prune(), PRUNE_MS);
  }

  beforeApplicationShutdown() {
    clearInterval(this.poller);
    clearInterval(this.pruner);
    this.closing.next();
    this.closing.complete();
  }

  emit(event: ChangeEvent) {
    this.changes.next(event);
    this.dataSource
      .query('INSERT INTO change_events (event, origin) VALUES (?, ?)', [event, this.origin])
      .catch((error: Error) => this.logger.error(`Could not share a change: ${error.message}`));
  }

  // The changes the other instances made since the last read.
  private async read() {
    if (this.reading) return;
    this.reading = true;
    try {
      const rows: { id: string | number; event: string; origin: string }[] = await this.dataSource.query(
        'SELECT id, event, origin FROM change_events WHERE id > ? ORDER BY id LIMIT 500',
        [this.lastId],
      );
      const seen = new Set<ChangeEvent>();
      for (const row of rows) {
        this.lastId = Number(row.id);
        if (row.origin !== this.origin && EVENTS.includes(row.event as ChangeEvent)) seen.add(row.event as ChangeEvent);
      }
      seen.forEach((event) => this.changes.next(event));
      if (this.failing) {
        // Changes made while the database was unreachable were missed: every page refetches everything.
        this.failing = false;
        EVENTS.forEach((event) => this.changes.next(event));
      }
    } catch (error) {
      if (!this.failing) this.logger.error(`Could not read changes: ${error instanceof Error ? error.message : String(error)}`);
      this.failing = true;
    } finally {
      this.reading = false;
    }
  }

  private async prune() {
    try {
      await this.dataSource.query('DELETE FROM change_events WHERE created_at < ?', [new Date(Date.now() - KEEP_MS)]);
    } catch {
      // Tried again next time.
    }
  }
}
