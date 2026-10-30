import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Result, TestCase } from '../catalog/entities';
import { RunsModule } from '../runs/runs.module';
import { ResultsController } from './results.controller';
import { ResultsService } from './results.service';

@Module({
  imports: [TypeOrmModule.forFeature([Result, TestCase]), RunsModule],
  controllers: [ResultsController],
  providers: [ResultsService],
})
export class ResultsModule {}
