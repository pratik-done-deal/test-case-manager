import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Result, TestCase } from '../catalog/entities';
import { Run } from './run.entity';
import { RunsController } from './runs.controller';
import { RunsService } from './runs.service';
import { TestIndexService } from './test-index.service';

@Module({
  imports: [TypeOrmModule.forFeature([Run, Result, TestCase])],
  controllers: [RunsController],
  providers: [RunsService, TestIndexService],
  exports: [TestIndexService],
})
export class RunsModule {}
