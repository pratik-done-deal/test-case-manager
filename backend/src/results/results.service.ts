import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Result, TestCase } from '../catalog/entities';
import { EventsService } from '../events/events.service';
import { Runner } from '../runners/runner.entity';
import { environmentKey } from '../runs/environment';
import { TestIndexService } from '../runs/test-index.service';

export type ResultStatus = 'pass' | 'fail';

@Injectable()
export class ResultsService {
  constructor(
    @InjectRepository(Runner) private readonly runners: Repository<Runner>,
    @InjectRepository(Result) private readonly results: Repository<Result>,
    @InjectRepository(TestCase) private readonly testCases: Repository<TestCase>,
    private readonly events: EventsService,
    private readonly index: TestIndexService,
  ) {}

  // { <test case id>: 'pass' | 'fail' } on one environment; a test case not run there has no entry.
  async getAll(environment: string): Promise<Record<string, ResultStatus>> {
    const rows = await this.results.find({ where: { environment } });
    return Object.fromEntries(rows.map((row) => [row.testCaseId, row.status]));
  }

  // Every environment that has results or a runner pointed at it, most results first.
  async environments(): Promise<{ key: string; results: number }[]> {
    const rows: { key: string; results: string | number }[] = await this.results
      .createQueryBuilder('result')
      .select('result.environment', 'key')
      .addSelect('COUNT(*)', 'results')
      .groupBy('result.environment')
      .getRawMany();
    const counts = new Map(rows.map((row) => [row.key, Number(row.results)]));
    for (const runner of await this.runners.find({ select: { id: true, environment: true } })) {
      const key = environmentKey(runner.environment?.appUrl);
      if (key && !counts.has(key)) counts.set(key, 0);
    }
    return [...counts]
      .map(([key, results]) => ({ key, results }))
      .sort((a, b) => b.results - a.results || a.key.localeCompare(b.key));
  }

  async set(testCaseId: string, environment: string, status: ResultStatus | null) {
    if (!(await this.testCases.existsBy({ id: testCaseId }))) {
      throw new NotFoundException(`No test case ${testCaseId}`);
    }
    // A case with an automated test gets its result from runs only; by hand only a manual check.
    if (await this.index.isAutomated(testCaseId)) {
      throw new ConflictException('This test case has an automated test; its result is set by running it');
    }
    if (status) await this.results.save({ testCaseId, environment, status, source: 'manual' });
    else await this.results.delete({ testCaseId, environment });
    this.events.emit('results');
    return { testCaseId, environment, result: status };
  }
}
