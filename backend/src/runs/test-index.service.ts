import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Subscription } from 'rxjs';
import { IsNull, Repository } from 'typeorm';
import { TestCase } from '../catalog/entities';
import { EventsService } from '../events/events.service';
import { Runner } from '../runners/runner.entity';
import { isOnline } from '../runners/online';
import { matchTests, RISKY_MARKERS, type CaseRef } from './match-tests';

export type Automation = {
  available: boolean;
  reason: string | null; // why tests can't be run on this runner, when they can't
  tests: number;
  // { <test case id>: how many tests cover it, and how many of those change data }
  cases: Record<string, { tests: number; risky: number }>;
};

// Which tests of one runner's ai-qa checkout cover which test case.
export type RunnerIndex = { byCase: Map<string, string[]>; risky: Set<string>; tests: number };

// Knows which ai-qa tests cover which test case, per runner: each laptop may have a different ai-qa
// branch checked out, so each has its own match. Runners send the tests they collect; they are matched
// to the cases here, again whenever either changes.
@Injectable()
export class TestIndexService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(TestIndexService.name);
  // Bumped on every catalog change, so a match against the old cases is made again.
  private catalogVersion = 0;
  private cases: { version: number; refs: Promise<CaseRef[]> } | null = null;
  private readonly indexes = new Map<string, { testsAt: number; version: number; index: RunnerIndex }>();
  private subscription?: Subscription;

  constructor(
    @InjectRepository(TestCase) private readonly testCases: Repository<TestCase>,
    @InjectRepository(Runner) private readonly runners: Repository<Runner>,
    private readonly events: EventsService,
  ) {}

  onApplicationBootstrap() {
    this.subscription = this.events.changes.subscribe((event) => {
      if (event === 'catalog') {
        this.catalogVersion++;
        this.events.emit('automation');
      }
    });
  }

  onModuleDestroy() {
    this.subscription?.unsubscribe();
  }

  // What the app shows about running tests on this runner.
  async getAutomation(runnerId: string | undefined): Promise<Automation> {
    const unavailable = (reason: string): Automation => ({ available: false, reason, tests: 0, cases: {} });
    if (!runnerId) return unavailable('Pick the laptop that runs the tests');
    const runner = await this.runners.findOneBy({ id: runnerId });
    if (!runner) return unavailable('That runner is no longer registered');
    if (runner.testsReason) return unavailable(runner.testsReason);
    if (!runner.testsAt) return unavailable(`${runner.name} has not collected its tests yet`);
    const { byCase, risky, tests } = await this.indexFor(runner);
    const cases: Automation['cases'] = {};
    for (const [key, nodeids] of byCase) {
      cases[key] = { tests: nodeids.length, risky: nodeids.filter((nodeid) => risky.has(nodeid)).length };
    }
    const reason = isOnline(runner) ? null : `${runner.name} is offline; start its runner agent`;
    return { available: !reason, reason, tests, cases };
  }

  // Whether any runner has a test for the case: its result then comes from runs, not by hand.
  async isAutomated(testCaseId: string) {
    const runners = await this.runners.find();
    for (const runner of runners) {
      if (runner.testsAt && (await this.indexFor(runner)).byCase.has(testCaseId)) return true;
    }
    return false;
  }

  async indexFor(runner: Runner): Promise<RunnerIndex> {
    const testsAt = runner.testsAt?.getTime() ?? 0;
    const cached = this.indexes.get(runner.id);
    if (cached && cached.testsAt === testsAt && cached.version === this.catalogVersion) return cached.index;

    const version = this.catalogVersion;
    const tests = runner.tests ?? [];
    const byCase = tests.length ? matchTests(tests, await this.caseRefs()) : new Map<string, string[]>();
    const risky = new Set(
      tests.filter((test) => test.markers.some((m) => RISKY_MARKERS.includes(m))).map((test) => test.nodeid),
    );
    const index = { byCase, risky, tests: tests.length };
    this.indexes.set(runner.id, { testsAt, version, index });
    this.logger.log(`${runner.name}: ${byCase.size} test cases have automated tests (${tests.length} tests)`);
    return index;
  }

  private caseRefs(): Promise<CaseRef[]> {
    if (this.cases?.version === this.catalogVersion) return this.cases.refs;
    const refs = this.testCases
      .find({
        where: { archivedAt: IsNull(), scenario: { archivedAt: IsNull(), suite: { archivedAt: IsNull() } } },
        relations: { scenario: { suite: true } },
      })
      .then((rows) =>
        rows.map((row) => ({
          key: row.id,
          code: row.code,
          req: row.req,
          kind: row.scenario.suite.kind,
          role: row.scenario.suite.role,
          node: row.scenario.suite.node,
          areas: row.areas,
        })),
      );
    this.cases = { version: this.catalogVersion, refs };
    refs.catch(() => {
      if (this.cases?.refs === refs) this.cases = null;
    });
    return refs;
  }
}
