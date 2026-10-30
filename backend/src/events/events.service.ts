import { BeforeApplicationShutdown, Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';

// automation: which test cases have tests changed. runs: a run started, moved on or ended.
// logins: a login window opened or closed, or a session was saved.
export type ChangeEvent = 'catalog' | 'results' | 'automation' | 'runs' | 'logins';

// Tells open pages that something changed, so they refetch it without waiting for their next poll.
@Injectable()
export class EventsService implements BeforeApplicationShutdown {
  readonly changes = new Subject<ChangeEvent>();
  // Fires when the backend shuts down. Open event streams end then: the server only closes once every
  // connection has, and a page left open would otherwise keep it (and a dev reload) waiting forever.
  readonly closing = new Subject<void>();

  beforeApplicationShutdown() {
    this.closing.next();
    this.closing.complete();
  }

  emit(event: ChangeEvent) {
    this.changes.next(event);
  }
}
