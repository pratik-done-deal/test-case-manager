import { Controller, Get } from '@nestjs/common';
import { RunnersService } from './runners.service';

@Controller('runners')
export class RunnersController {
  constructor(private readonly runners: RunnersService) {}

  @Get()
  list() {
    return this.runners.list();
  }
}
