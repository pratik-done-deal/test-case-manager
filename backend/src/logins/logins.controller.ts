import { Controller, Get, Param, ParseEnumPipe, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { LoginsService, ROLES, type Role } from './logins.service';

const ROLE = new ParseEnumPipe(Object.fromEntries(ROLES.map((role) => [role, role])));
const RUNNER = new ParseUUIDPipe();

// Every route takes ?runner=<id>: the laptop whose ai-qa checkout keeps the logins.
@Controller('logins')
export class LoginsController {
  constructor(private readonly logins: LoginsService) {}

  @Get()
  list(@Query('runner', new ParseUUIDPipe({ optional: true })) runner?: string) {
    return this.logins.list(runner);
  }

  // Opens the login browser for the role on the runner's laptop.
  @Post(':role')
  start(@Param('role', ROLE) role: Role, @Query('runner', RUNNER) runner: string) {
    return this.logins.start(runner, role);
  }

  // Saves the session the tester logged in with.
  @Post(':role/save')
  save(@Param('role', ROLE) role: Role, @Query('runner', RUNNER) runner: string) {
    return this.logins.save(runner, role);
  }

  @Post(':role/cancel')
  cancel(@Param('role', ROLE) role: Role, @Query('runner', RUNNER) runner: string) {
    return this.logins.cancel(runner, role);
  }
}
