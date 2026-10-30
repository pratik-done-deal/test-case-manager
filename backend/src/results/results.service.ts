import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Result, TestCase } from '../catalog/entities';
import { EventsService } from '../events/events.service';
import { TestIndexService } from '../runs/test-index.service';

export type ResultStatus = 'pass' | 'fail';

@Injectable()
export class ResultsService {
  constructor(
    @InjectRepository(Result) private readonly results: Repository<Result>,
    @InjectRepository(TestCase) private readonly testCases: Repository<TestCase>,
    private readonly events: EventsService,
    private readonly index: TestIndexService,
  ) {}

  // { <test case id>: 'pass' | 'fail' }; a test case that is not run has no entry.
  async getAll(): Promise<Record<string, ResultStatus>> {
    const rows = await this.results.find();
    return Object.fromEntries(rows.map((row) => [row.testCaseId, row.status]));
  }

  async set(testCaseId: string, status: ResultStatus | null) {
    if (!(await this.testCases.existsBy({ id: testCaseId }))) {
      throw new NotFoundException(`No test case ${testCaseId}`);
    }
    // A case with an automated test gets its result from runs only; by hand only a manual check.
    if (this.index.testsFor(testCaseId).length) {
      throw new ConflictException('This test case has an automated test; its result is set by running it');
    }
    if (status) await this.results.save({ testCaseId, status });
    else await this.results.delete({ testCaseId });
    this.events.emit('results');
    return { testCaseId, result: status };
  }
}
