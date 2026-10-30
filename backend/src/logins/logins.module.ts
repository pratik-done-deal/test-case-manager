import { Module } from '@nestjs/common';
import { LoginsController } from './logins.controller';
import { LoginsService } from './logins.service';

@Module({
  controllers: [LoginsController],
  providers: [LoginsService],
})
export class LoginsModule {}
