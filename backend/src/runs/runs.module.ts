import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Result, TestCase } from '../catalog/entities';
import { Runner } from '../runners/runner.entity';
import { Run, RunTest, Screenshot } from './run.entity';
import { RunsController } from './runs.controller';
import { RunsService } from './runs.service';
import { TestIndexService } from './test-index.service';

@Module({
  imports: [TypeOrmModule.forFeature([Run, RunTest, Screenshot, Result, TestCase, Runner])],
  controllers: [RunsController],
  providers: [RunsService, TestIndexService],
  exports: [RunsService, TestIndexService],
})
export class RunsModule {}
