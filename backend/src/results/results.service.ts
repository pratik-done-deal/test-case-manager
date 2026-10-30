import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Result, TestCase } from '../catalog/entities';
import { EventsService } from '../events/events.service';
import { TestIndexService } from '../runs/test-index.service';

export type ResultStatus = 'pass' | 'fail';

@Injectable()
export class ResultsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
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
    const rows: { key: string; results: string }[] = await this.dataSource.query(`
      SELECT key, sum(n)::int AS results FROM (
        SELECT environment AS key, count(*) AS n FROM results GROUP BY environment
        UNION ALL
        SELECT substring(environment ->> 'appUrl' from '^[a-z]+://([^/]+)'), 0 FROM runners
        WHERE environment ->> 'appUrl' IS NOT NULL
      ) environments
      GROUP BY key ORDER BY results DESC, key
    `);
    return rows.map((row) => ({ key: row.key, results: Number(row.results) }));
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
