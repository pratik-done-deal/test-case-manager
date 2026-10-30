import { Body, Controller, Get, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { IsIn, ValidateIf } from 'class-validator';
import { ResultsService, type ResultStatus } from './results.service';

class SetResultDto {
  // null clears the result, back to "not run".
  @ValidateIf((dto: SetResultDto) => dto.result !== null)
  @IsIn(['pass', 'fail'])
  result: ResultStatus | null;
}

@Controller('results')
export class ResultsController {
  constructor(private readonly results: ResultsService) {}

  @Get()
  getAll() {
    return this.results.getAll();
  }

  @Put(':testCaseId')
  set(@Param('testCaseId', ParseUUIDPipe) testCaseId: string, @Body() body: SetResultDto) {
    return this.results.set(testCaseId, body.result);
  }
}
