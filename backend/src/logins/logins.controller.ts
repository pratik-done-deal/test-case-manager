import { Controller, Get, Param, ParseEnumPipe, Post } from '@nestjs/common';
import { LoginsService, ROLES, type Role } from './logins.service';

const ROLE = new ParseEnumPipe(Object.fromEntries(ROLES.map((role) => [role, role])));

@Controller('logins')
export class LoginsController {
  constructor(private readonly logins: LoginsService) {}

  @Get()
  list() {
    return this.logins.list();
  }

  // Opens the login browser for the role.
  @Post(':role')
  start(@Param('role', ROLE) role: Role) {
    return this.logins.start(role);
  }

  // Saves the session the tester logged in with.
  @Post(':role/save')
  save(@Param('role', ROLE) role: Role) {
    return this.logins.save(role);
  }

  @Post(':role/cancel')
  cancel(@Param('role', ROLE) role: Role) {
    return this.logins.cancel(role);
  }
}
