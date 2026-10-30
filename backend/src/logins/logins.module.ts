import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Runner } from '../runners/runner.entity';
import { LoginsController } from './logins.controller';
import { LoginsService } from './logins.service';

@Module({
  imports: [TypeOrmModule.forFeature([Runner])],
  controllers: [LoginsController],
  providers: [LoginsService],
})
export class LoginsModule {}
