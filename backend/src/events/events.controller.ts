import { Controller, MessageEvent, Sse } from '@nestjs/common';
import { interval, map, merge, Observable, takeUntil } from 'rxjs';
import { EventsService } from './events.service';

const HEARTBEAT_MS = 25_000;

@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  // The heartbeat keeps proxies from closing a stream that has been quiet for a while.
  @Sse()
  stream(): Observable<MessageEvent> {
    return merge(
      this.events.changes.pipe(map((event) => ({ type: event, data: event }))),
      interval(HEARTBEAT_MS).pipe(map(() => ({ type: 'ping', data: 'ping' }))),
    ).pipe(takeUntil(this.events.closing));
  }
}
