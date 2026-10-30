import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

// Runner agents send RUNNER_TOKEN in the x-runner-token header. While it is empty, the agent endpoints are off.
@Injectable()
export class RunnerTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const expected = process.env.RUNNER_TOKEN;
    const token = context.switchToHttp().getRequest<Request>().header('x-runner-token');
    if (!expected || !token) throw new ForbiddenException();
    const a = Buffer.from(token);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ForbiddenException();
    return true;
  }
}
