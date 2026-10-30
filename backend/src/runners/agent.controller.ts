import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
import { IsArray, IsBoolean, IsInt, IsObject, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import type { CollectedTest } from '../runs/match-tests';
import type { RunEnvironment } from '../runs/run.entity';
import { RunsService, type ProgressEvent } from '../runs/runs.service';
import type { RunnerLogins } from './runner.entity';
import { RunnersService } from './runners.service';
import { RunnerTokenGuard } from './runner-token.guard';

class HelloDto {
  @IsString()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsObject()
  environment?: RunEnvironment;

  @IsOptional()
  @IsObject()
  logins?: RunnerLogins;
}

class TestsDto {
  @IsArray()
  tests: CollectedTest[];

  // Why the tests could not be collected, when they couldn't.
  @ValidateIf((dto: TestsDto) => dto.reason !== null)
  @IsString()
  reason: string | null;

  // Sent again when the checkout moved to another branch or commit, or its settings to another app.
  @IsOptional()
  @IsObject()
  environment?: RunEnvironment;
}

class LoginsDto {
  @IsObject()
  logins: RunnerLogins;
}

class ProgressDto {
  @IsArray()
  events: ProgressEvent[];

  // pytest output since the last report.
  @IsString()
  log: string;
}

class FinishDto {
  @ValidateIf((dto: FinishDto) => dto.exitCode !== null)
  @IsInt()
  exitCode: number | null;

  @IsBoolean()
  stopped: boolean;
}

const RUNNER = new ParseUUIDPipe();

// What runner agents call. Every route needs the x-runner-token header.
@Controller('agent')
@UseGuards(RunnerTokenGuard)
export class AgentController {
  constructor(
    private readonly runners: RunnersService,
    private readonly runs: RunsService,
  ) {}

  @Post('hello')
  @HttpCode(200)
  hello(@Body() body: HelloDto) {
    return this.runners.hello(body.name, body.environment ?? null, body.logins ?? null);
  }

  @Put(':runner/tests')
  tests(@Param('runner', RUNNER) runner: string, @Body() body: TestsDto) {
    return this.runners.setTests(runner, body.tests, body.reason, body.environment ?? null);
  }

  @Put(':runner/logins')
  logins(@Param('runner', RUNNER) runner: string, @Body() body: LoginsDto) {
    return this.runners.setLogins(runner, body.logins);
  }

  @Post(':runner/poll')
  @HttpCode(200)
  poll(@Param('runner', RUNNER) runner: string) {
    return this.runners.poll(runner);
  }

  @Post(':runner/runs/:id/progress')
  @HttpCode(200)
  progress(@Param('runner', RUNNER) runner: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: ProgressDto) {
    return this.runs.progress(runner, id, body.events, body.log);
  }

  @Post(':runner/runs/:id/finish')
  @HttpCode(200)
  finish(@Param('runner', RUNNER) runner: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: FinishDto) {
    return this.runs.finish(runner, id, body.exitCode, body.stopped);
  }
}
