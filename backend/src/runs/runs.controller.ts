import { Body, Controller, DefaultValuePipe, Get, Param, ParseIntPipe, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import type { Response } from 'express';
import { RunsService } from './runs.service';
import { TestIndexService } from './test-index.service';

// What the run covers, so its report can be compared with earlier runs of the same thing.
class ScopeDto {
  @IsIn(['case', 'scenario', 'page', 'filtered', 'role'])
  kind: 'case' | 'scenario' | 'page' | 'filtered' | 'role';

  @IsString()
  @MaxLength(500)
  key: string;

  @IsString()
  @MaxLength(300)
  name: string;
}

class StartRunDto {
  @IsString()
  @MaxLength(300)
  label: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(10_000)
  @IsUUID('all', { each: true })
  testCaseKeys: string[];

  // Also run tests marked destructive or live_login, which change QA data or send real logins.
  @IsOptional()
  @IsBoolean()
  includeDestructive?: boolean;

  // Show the browser (only useful when the backend runs on your own machine).
  @IsOptional()
  @IsBoolean()
  headed?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => ScopeDto)
  scope?: ScopeDto;
}

@Controller('runs')
export class RunsController {
  constructor(
    private readonly runs: RunsService,
    private readonly index: TestIndexService,
  ) {}

  @Get('automation')
  automation() {
    return this.index.getAutomation();
  }

  // ?log=1 adds pytest's output.
  @Get('current')
  current(@Query('log') log?: string) {
    return this.runs.current(log === '1');
  }

  @Post()
  start(@Body() body: StartRunDto) {
    return this.runs.start({
      label: body.label,
      testCaseKeys: body.testCaseKeys,
      includeDestructive: body.includeDestructive ?? false,
      headed: body.headed ?? false,
      scope: body.scope ? { kind: body.scope.kind, key: body.scope.key, name: body.scope.name } : null,
    });
  }

  // Past runs, newest first; ?scope=<key> for the runs of one module, scenario or role.
  @Get()
  history(
    @Query('scope') scope: string | undefined,
    @Query('limit', new DefaultValuePipe(200), ParseIntPipe) limit: number,
  ) {
    return this.runs.history(scope, Math.min(Math.max(limit, 1), 1000));
  }

  @Get(':id/report')
  report(@Param('id', ParseUUIDPipe) id: string) {
    return this.runs.report(id);
  }

  // pytest's output for the run, as plain text.
  @Get(':id/log')
  async log(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    res.type('text/plain').send(await this.runs.log(id));
  }

  @Get(':id/screenshots/:file')
  screenshot(@Param('id', ParseUUIDPipe) id: string, @Param('file') file: string, @Res() res: Response) {
    res.sendFile(this.runs.screenshot(id, file));
  }

  @Post(':id/stop')
  stop(@Param('id', ParseUUIDPipe) id: string) {
    return this.runs.stop(id);
  }
}
