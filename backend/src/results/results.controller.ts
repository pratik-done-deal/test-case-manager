import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Query } from '@nestjs/common';
import { IsIn, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
import { ResultsService, type ResultStatus } from './results.service';

// An environment is the host of the app the tests point at: "qa.done.deals", "localhost:3000".
const ENVIRONMENT = /^[\w.-]+(:\d+)?$/;

class SetResultDto {
  // null clears the result, back to "not run".
  @ValidateIf((dto: SetResultDto) => dto.result !== null)
  @IsIn(['pass', 'fail'])
  result: ResultStatus | null;

  @IsString()
  @MaxLength(200)
  @Matches(ENVIRONMENT)
  environment: string;
}

@Controller('results')
export class ResultsController {
  constructor(private readonly results: ResultsService) {}

  // ?environment=<host>
  @Get()
  getAll(@Query('environment') environment = '') {
    return ENVIRONMENT.test(environment) ? this.results.getAll(environment) : {};
  }

  @Get('environments')
  environments() {
    return this.results.environments();
  }

  @Put(':testCaseId')
  set(@Param('testCaseId', ParseUUIDPipe) testCaseId: string, @Body() body: SetResultDto) {
    return this.results.set(testCaseId, body.environment, body.result);
  }
}
