import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Folder, Suite } from './entities';

@Injectable()
export class CatalogService {
  constructor(
    @InjectRepository(Suite) private readonly suites: Repository<Suite>,
    @InjectRepository(Folder) private readonly folders: Repository<Folder>,
  ) {}

  // Every live suite with its scenarios and test cases, in file order, plus the folder names and
  // statuses. A test case's `key` is its permanent database id; `id` is the code people see ("S1-01").
  async getCatalog() {
    const [suites, folders] = await Promise.all([
      this.suites.find({
        where: { archivedAt: IsNull() },
        relations: { scenarios: { cases: true } },
        order: { kind: 'ASC', role: 'ASC', node: 'ASC' },
      }),
      this.folders.find({ order: { kind: 'ASC', role: 'ASC', path: 'ASC' } }),
    ]);
    const live = <T extends { archivedAt: Date | null; position: number }>(rows: T[]) =>
      rows.filter((row) => !row.archivedAt).sort((a, b) => a.position - b.position);

    return {
      folders: folders.map(({ kind, role, path, name, status, reqPrefix }) => ({ kind, role, path, name, status, reqPrefix })),
      suites: suites.map((suite) => ({
        key: suite.id,
        kind: suite.kind,
        role: suite.role,
        node: suite.node,
        source: suite.source,
        title: suite.title,
        status: suite.status,
        coverage: suite.coverage,
        intro: suite.intro,
        happyFlow: suite.happyFlow,
        setup: suite.setup,
        scenarios: live(suite.scenarios).map((scenario) => ({
          id: scenario.code,
          title: scenario.title,
          role: scenario.role,
          bizUser: scenario.bizUser,
          feature: scenario.feature,
          precondition: scenario.precondition,
          path: scenario.path,
          cases: live(scenario.cases).map((testCase) => ({
            key: testCase.id,
            id: testCase.code,
            title: testCase.title,
            given: testCase.given,
            steps: testCase.steps,
            expected: testCase.expected,
            priority: testCase.priority,
            type: testCase.type,
            req: testCase.req,
            runAs: testCase.runAs,
            detail: testCase.detail,
            areas: testCase.areas,
            feature: testCase.feature,
          })),
        })),
      })),
    };
  }
}
