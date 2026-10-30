import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RunsModule } from '../runs/runs.module';
import { AgentController } from './agent.controller';
import { Runner } from './runner.entity';
import { RunnersController } from './runners.controller';
import { RunnersService } from './runners.service';

@Module({
  imports: [TypeOrmModule.forFeature([Runner]), RunsModule],
  controllers: [RunnersController, AgentController],
  providers: [RunnersService],
})
export class RunnersModule {}
