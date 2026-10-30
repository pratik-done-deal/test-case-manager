import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, IsNull, Not, Repository } from 'typeorm';
import { Result, TestCase } from '../catalog/entities';
import { EventsService } from '../events/events.service';
import { isOnline } from '../runners/online';
import { Runner } from '../runners/runner.entity';
import { environmentKey, UNKNOWN_ENVIRONMENT } from './environment';
import { buildReport, summarize } from './report';
import { contentTypeOf, isSafeFile, runsToKeep, screenshotFile } from './report-store';
import { Run, RunTest, Screenshot, type RunScope, type RunStatus, type TestOutcome } from './run.entity';
import { TestIndexService } from './test-index.service';

const LOG_LIMIT = 200_000;
// A running run whose runner hasn't reported for this long was interrupted (laptop closed, agent killed).
const SILENT_MS = 60_000;
// A queued run whose runner went offline and never picked it up is dropped after this long.
const UNCLAIMED_MS = 10 * 60_000;
const WATCH_MS = 15_000;

export type StartRun = {
  label: string;
  testCaseKeys: string[];
  includeDestructive: boolean;
  headed: boolean;
  scope: RunScope | null;
  runnerId: string;
};

// What a runner reports while it runs: a test started, or a test is done with its outcome and the
// screenshots ai-qa took (base64), sent once so the runner's copies can be overwritten.
export type ProgressEvent =
  | { nodeid: string; event: 'start' }
  | {
      nodeid: string;
      event: 'done';
      outcome: string;
      message: string | null;
      duration?: number;
      screenshots?: { url: string; name: string; data: string }[];
    };

// Runs whose report opens by itself when they end: more than a single case.
const REPORTED: RunScope['kind'][] = ['scenario', 'page', 'filtered', 'role'];

// A case passes when its tests ran and none failed. Skipped and expected-failure (pending feature)
// tests say nothing about it, so a case with only those keeps the result it had.
function caseResult(outcomes: string[]): 'pass' | 'fail' | null {
  if (outcomes.some((outcome) => outcome === 'failed' || outcome === 'error')) return 'fail';
  if (outcomes.some((outcome) => outcome === 'passed' || outcome === 'xpassed')) return 'pass';
  return null;
}

// Queues the tests of the chosen test cases for a runner agent on a tester's laptop, one run at a time
// per runner, and records what the runner reports: each test's outcome as it finishes, and each case's
// pass / fail as soon as its last test is done.
@Injectable()
export class RunsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RunsService.name);
  private watcher?: NodeJS.Timeout;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Run) private readonly runs: Repository<Run>,
    @InjectRepository(RunTest) private readonly runTests: Repository<RunTest>,
    @InjectRepository(Screenshot) private readonly screenshots: Repository<Screenshot>,
    @InjectRepository(TestCase) private readonly testCases: Repository<TestCase>,
    @InjectRepository(Runner) private readonly runners: Repository<Runner>,
    private readonly index: TestIndexService,
    private readonly events: EventsService,
  ) {}

  // Runs from before reports existed get their summary. Runs that went quiet are looked for regularly.
  async onApplicationBootstrap() {
    for (const run of await this.withOutcomes(
      await this.runs.find({ where: { summary: IsNull(), status: Not(In(['queued', 'running'])) } }),
    )) {
      await this.runs.update(run.id, { summary: summarize(run) });
    }
    this.watcher = setInterval(() => void this.dropQuietRuns(), WATCH_MS);
  }

  onModuleDestroy() {
    clearInterval(this.watcher);
  }

  // The run going now on the runner, else its last one (any runner's when none is given); with what
  // the app shows about it. Its output only when asked, since pages refetch this on every step of a run.
  async current(runnerId: string | undefined, withLog: boolean) {
    const run = await this.runs.findOne({
      where: runnerId ? { runnerId } : {},
      order: { startedAt: 'DESC' },
    });
    if (!run) return null;
    const [loaded] = await this.withOutcomes([run]);
    const described = await this.describe(loaded);
    return withLog ? { ...described, log: run.log } : described;
  }

  async start({ label, testCaseKeys, includeDestructive, headed, scope, runnerId }: StartRun) {
    const runner = await this.runners.findOneBy({ id: runnerId });
    if (!runner) throw new NotFoundException('That runner is no longer registered');
    if (!isOnline(runner)) throw new ServiceUnavailableException(`${runner.name} is offline; start its runner agent`);
    if (runner.testsReason) throw new ServiceUnavailableException(runner.testsReason);

    const { byCase, risky } = await this.index.indexFor(runner);
    const cases: Record<string, string[]> = {};
    for (const key of new Set(testCaseKeys)) {
      const nodeids = (byCase.get(key) ?? []).filter((nodeid) => includeDestructive || !risky.has(nodeid));
      if (nodeids.length) cases[key] = nodeids;
    }
    const total = new Set(Object.values(cases).flat()).size;
    if (!total) throw new BadRequestException('None of these test cases has a test that can run');

    const snapshot = await this.snapshot(Object.keys(cases));

    // One run at a time per runner: locking its row makes two Run clicks at once queue only one.
    const run = await this.dataSource.transaction(async (manager) => {
      await manager.findOne(Runner, { where: { id: runnerId }, select: { id: true }, lock: { mode: 'pessimistic_write' } });
      const going = await manager.findOne(Run, { where: { runnerId, status: In(['queued', 'running']) } });
      if (going) throw new ConflictException(`${runner.name} already has a run going; stop it or wait for it to end`);
      return manager.save(
        manager.create(Run, {
          label,
          status: 'queued',
          runnerId,
          environment: runner.environment,
          environmentKey: environmentKey(runner.environment?.appUrl),
          stopRequested: false,
          heartbeatAt: null,
          currentTest: null,
          options: { includeDestructive, headed },
          scope,
          scopeKey: scope?.key ?? null,
          cases,
          snapshot,
          summary: null,
          log: '',
          exitCode: null,
          startedAt: new Date(),
          finishedAt: null,
        }),
      );
    });
    run.outcomes = {};

    this.logger.log(`Run ${run.id}: ${total} tests for ${Object.keys(cases).length} test cases on ${runner.name} (${label})`);
    this.events.emit('runs');
    return this.describe(run);
  }

  // A queued run ends at once; a running one is ended by its runner when it next reports.
  async stop(id: string) {
    const run = await this.runs.findOneBy({ id });
    if (!run || (run.status !== 'queued' && run.status !== 'running')) throw new NotFoundException('That run is not going');
    if (run.status === 'queued') {
      await this.end(run, 'stopped', null);
    } else {
      await this.runs.update(id, { stopRequested: true });
      run.stopRequested = true;
      this.events.emit('runs');
    }
    const [loaded] = await this.withOutcomes([run]);
    return this.describe(loaded);
  }

  // The runner's next queued run, now running; null when there is none.
  async claim(runnerId: string) {
    const row = await this.dataSource.transaction(async (manager) => {
      const [queued]: { id: string }[] = await manager.query(
        `SELECT id FROM runs WHERE runner_id = ? AND status = 'queued'
         ORDER BY started_at LIMIT 1 FOR UPDATE SKIP LOCKED`,
        [runnerId],
      );
      if (!queued) return null;
      const now = new Date();
      await manager.update(Run, queued.id, { status: 'running', heartbeatAt: now, startedAt: now });
      return manager.findOne(Run, { where: { id: queued.id }, select: { id: true, cases: true, options: true } });
    });
    if (!row) return null;
    this.events.emit('runs');
    return { id: row.id, nodeids: [...new Set(Object.values(row.cases).flat())], headed: row.options.headed };
  }

  // Records what the runner reports: finished tests, the test running now and new output. The results
  // of the cases whose last test is now done are set. Returns whether the runner should stop.
  async progress(runnerId: string, id: string, events: ProgressEvent[], log: string) {
    const outcome = await this.dataSource.transaction(async (manager) => {
      // Locked, so two reports for the same run never number their tests the same.
      const run = await manager.findOne(Run, { where: { id, runnerId }, lock: { mode: 'pessimistic_write' } });
      if (!run) throw new NotFoundException('No such run on this runner');
      if (run.status !== 'running') return { stop: true, changed: false, results: false };

      let position = await manager.count(RunTest, { where: { runId: id } });
      let current = run.currentTest;
      const done: string[] = [];
      for (const event of events) {
        if (event.event === 'start') {
          current = event.nodeid;
          continue;
        }
        const screenshots = await this.keepScreenshots(manager, id, position, event.screenshots ?? []);
        const inserted = await manager
          .createQueryBuilder()
          .insert()
          .into(RunTest)
          .values({
            runId: id,
            nodeid: event.nodeid,
            position,
            outcome: event.outcome,
            message: event.message ?? null,
            duration: event.duration ?? null,
            screenshots,
          })
          .orIgnore() // a report the runner sent again after a lost reply
          .execute();
        if ((inserted.raw as { affectedRows: number }).affectedRows) {
          position++;
          done.push(event.nodeid);
        }
        if (current === event.nodeid) current = null;
      }

      await manager.query(
        `UPDATE runs SET log = RIGHT(CONCAT(log, ?), ${LOG_LIMIT}), heartbeat_at = ?, current_test = ? WHERE id = ?`,
        [log, new Date(), current, id],
      );
      const results = done.length ? await this.recordResults(manager, run, done) : false;
      return { stop: run.stopRequested, changed: done.length > 0 || Boolean(log) || current !== run.currentTest, results };
    });
    if (outcome.results) this.events.emit('results');
    if (outcome.changed) this.events.emit('runs');
    return { stop: outcome.stop };
  }

  // pytest has exited: 0 when all passed and 1 when some failed; anything else means it could not run them.
  async finish(runnerId: string, id: string, exitCode: number | null, stopped: boolean) {
    const run = await this.runs.findOneBy({ id, runnerId });
    if (!run) throw new NotFoundException('No such run on this runner');
    if (run.status !== 'running') return { status: run.status };
    const status: RunStatus = stopped || run.stopRequested ? 'stopped' : exitCode === 0 || exitCode === 1 ? 'finished' : 'error';
    await this.end(run, status, exitCode);
    this.logger.log(`Run ${run.id} ${status} (exit ${exitCode})`);
    return { status };
  }

  // Every run with its summary, newest first; only those of one scope when given.
  async history(scopeKey: string | undefined, limit: number) {
    const query = this.runs
      .createQueryBuilder('run')
      .select(['run.id', 'run.label', 'run.status', 'run.scope', 'run.options', 'run.summary', 'run.startedAt', 'run.finishedAt'])
      .where('run.status NOT IN (:...going)', { going: ['queued', 'running'] })
      .orderBy('run.startedAt', 'DESC')
      .limit(limit);
    if (scopeKey) query.andWhere('run.scopeKey = :scopeKey', { scopeKey });
    return query.getMany();
  }

  // The report of one run: compared with the previous run of the same thing, with its trend.
  async report(id: string) {
    const found = await this.runs.findOneBy({ id });
    if (!found) throw new NotFoundException('No such run');
    // Runs from before reports have no snapshot: the cases as they read now are the best there is.
    const missing = Object.keys(found.cases).filter((key) => !found.snapshot[key]);
    if (missing.length) {
      found.snapshot = { ...found.snapshot, ...(await this.snapshot(missing)) };
      if (found.status !== 'running' && found.status !== 'queued') await this.runs.update(found.id, { snapshot: found.snapshot });
    }
    let earlier: Run[] = [];
    if (found.scope?.key) {
      earlier = await this.runs
        .createQueryBuilder('run')
        .where('run.scopeKey = :key', { key: found.scope.key })
        .andWhere('run.startedAt < :startedAt', { startedAt: found.startedAt })
        .andWhere('run.status IN (:...statuses)', { statuses: ['finished', 'stopped'] })
        .orderBy('run.startedAt', 'DESC')
        .limit(9)
        .getMany();
    }
    const [run, ...past] = await this.withOutcomes([found, ...earlier]);
    const previous = past[0] ?? null;
    const trend = [...past.reverse(), run];
    const kept = new Set(
      (await this.screenshots.find({ where: { runId: In([run.id]) }, select: { runId: true, file: true } })).map(
        (shot) => `${shot.runId}/${shot.file}`,
      ),
    );
    const runner = run.runnerId ? await this.runners.findOneBy({ id: run.runnerId }) : null;
    const report = buildReport(run, previous, trend, (of, file) =>
      kept.has(`${of.id}/${file}`) ? `/runs/${of.id}/screenshots/${encodeURIComponent(file)}` : null,
    );
    return { ...report, run: { ...report.run, runner: runner?.name ?? null, environmentKey: run.environmentKey } };
  }

  async log(id: string) {
    const run = await this.runs.findOne({ where: { id }, select: { id: true, log: true } });
    if (!run) throw new NotFoundException('No such run');
    return run.log;
  }

  async screenshot(id: string, file: string) {
    const shot = isSafeFile(file) ? await this.screenshots.findOneBy({ runId: id, file }) : null;
    if (!shot) throw new NotFoundException('That screenshot is not kept any more');
    return shot;
  }

  // The cases as they read now, kept with a run so its report still reads right after they change.
  private async snapshot(keys: string[]) {
    const rows = await this.testCases.find({ where: { id: In(keys) }, relations: { scenario: { suite: true } } });
    return Object.fromEntries(
      rows.map((row) => [
        row.id,
        {
          code: row.code,
          title: row.title,
          priority: row.priority,
          scenario: { id: row.scenario.code, title: row.scenario.title },
          suite: { title: row.scenario.suite.title, node: row.scenario.suite.node },
        },
      ]),
    );
  }

  // Fills in each run's outcomes from its run_tests rows, in the order they finished.
  private async withOutcomes(runs: Run[]) {
    if (!runs.length) return runs;
    const rows = await this.runTests.find({ where: { runId: In(runs.map((run) => run.id)) }, order: { position: 'ASC' } });
    for (const run of runs) run.outcomes = {};
    const byId = new Map(runs.map((run) => [run.id, run]));
    for (const row of rows) {
      const outcome: TestOutcome = { outcome: row.outcome, message: row.message };
      if (row.duration !== null) outcome.duration = row.duration;
      if (row.screenshots.length) outcome.screenshots = row.screenshots;
      byId.get(row.runId)!.outcomes[row.nodeid] = outcome;
    }
    return runs;
  }

  private async keepScreenshots(
    manager: EntityManager,
    runId: string,
    position: number,
    shots: { url: string; name: string; data: string }[],
  ) {
    const kept: { url: string; file: string }[] = [];
    for (const [n, shot] of shots.entries()) {
      const file = screenshotFile(position, n, shot.name);
      await manager
        .createQueryBuilder()
        .insert()
        .into(Screenshot)
        .values({ runId, file, contentType: contentTypeOf(file), data: Buffer.from(shot.data, 'base64') })
        .orIgnore()
        .execute();
      kept.push({ url: shot.url, file });
    }
    return kept;
  }

  // Sets the result of every case whose tests are now all done, under the run's environment.
  private async recordResults(manager: EntityManager, run: Run, done: string[]) {
    const finished = new Set(done);
    const rows = await manager.find(RunTest, { where: { runId: run.id }, select: { nodeid: true, outcome: true } });
    const outcomes = new Map(rows.map((row) => [row.nodeid, row.outcome]));
    const updates: { testCaseId: string; status: 'pass' | 'fail' }[] = [];
    for (const [key, nodeids] of Object.entries(run.cases)) {
      if (!nodeids.some((nodeid) => finished.has(nodeid))) continue;
      if (!nodeids.every((nodeid) => outcomes.has(nodeid))) continue;
      const status = caseResult(nodeids.map((nodeid) => outcomes.get(nodeid)!));
      if (status) updates.push({ testCaseId: key, status });
    }
    if (!updates.length) return false;
    // A case archived while the run went on has no row to hang a result on any more.
    const live = await manager.find(TestCase, {
      select: { id: true },
      where: { id: In(updates.map((update) => update.testCaseId)) },
    });
    const ids = new Set(live.map((row) => row.id));
    const environment = run.environmentKey ?? UNKNOWN_ENVIRONMENT;
    const kept = updates
      .filter((update) => ids.has(update.testCaseId))
      .map((update) => ({ ...update, environment, source: run.id }));
    if (kept.length) await manager.save(Result, kept);
    return kept.length > 0;
  }

  private async end(run: Run, status: RunStatus, exitCode: number | null) {
    const [loaded] = await this.withOutcomes([run]);
    loaded.status = status;
    loaded.exitCode = exitCode;
    loaded.finishedAt = new Date();
    loaded.currentTest = null;
    const summary = summarize(loaded);
    await this.runs.update(run.id, { status, exitCode, finishedAt: loaded.finishedAt, currentTest: null, summary });
    await this.prune();
    this.events.emit('runs');
  }

  // Runs whose runner went quiet can't be followed any more. Safe to run on every instance at once:
  // each update only touches runs still in the state it looks for.
  private async dropQuietRuns() {
    try {
      const silent = await this.runs
        .createQueryBuilder('run')
        .where(`run.status = 'running'`)
        .andWhere('run.heartbeatAt < :since', { since: new Date(Date.now() - SILENT_MS) })
        .getMany();
      for (const run of silent) {
        const { affected } = await this.runs.update({ id: run.id, status: 'running' }, { status: 'interrupted' });
        if (affected) await this.end(run, 'interrupted', null);
      }
      const unclaimed = await this.runs
        .createQueryBuilder('run')
        .innerJoin(Runner, 'runner', 'runner.id = run.runnerId')
        .where(`run.status = 'queued'`)
        .andWhere('run.startedAt < :since', { since: new Date(Date.now() - UNCLAIMED_MS) })
        .andWhere('runner.lastSeenAt < :seen', { seen: new Date(Date.now() - SILENT_MS) })
        .getMany();
      for (const run of unclaimed) {
        const { affected } = await this.runs.update({ id: run.id, status: 'queued' }, { status: 'stopped' });
        if (affected) await this.end(run, 'stopped', null);
      }
    } catch (error) {
      this.logger.error('Could not check for quiet runs', error instanceof Error ? error.stack : String(error));
    }
  }

  // Removes the screenshots of runs that are neither recent nor among the last runs of their scope.
  private async prune() {
    try {
      const rows = await this.runs.find({ select: { id: true, scope: true, startedAt: true } });
      const keep = [...runsToKeep(rows.map((row) => ({ id: row.id, scopeKey: row.scope?.key ?? null, startedAt: row.startedAt })))];
      const { affected } = await this.screenshots
        .createQueryBuilder()
        .delete()
        .where(keep.length ? 'run_id NOT IN (:...keep)' : 'true', { keep })
        .execute();
      if (affected) this.logger.log(`Removed ${affected} screenshots of old runs`);
    } catch (error) {
      this.logger.error('Could not prune screenshots', error instanceof Error ? error.stack : String(error));
    }
  }

  private async describe(run: Run) {
    const counts: Record<string, number> = {};
    for (const { outcome } of Object.values(run.outcomes)) counts[outcome] = (counts[outcome] ?? 0) + 1;
    const tests = new Set(Object.values(run.cases).flat());
    // { <test case id>: queued | running | pass | fail | skipped }
    const cases: Record<string, string> = {};
    const going = run.status === 'running' || run.status === 'queued';
    const current = run.status === 'running' ? run.currentTest : null;
    for (const [key, nodeids] of Object.entries(run.cases)) {
      const outcomes = nodeids.map((nodeid) => run.outcomes[nodeid]?.outcome);
      if (outcomes.every(Boolean)) cases[key] = caseResult(outcomes as string[]) ?? 'skipped';
      else if (!going) cases[key] = 'not run';
      else if (current && nodeids.includes(current)) cases[key] = 'running';
      else if (outcomes.some(Boolean)) cases[key] = 'running';
      else cases[key] = 'queued';
    }
    const problems = Object.entries(run.outcomes)
      .filter(([, { outcome }]) => outcome === 'failed' || outcome === 'error')
      .map(([nodeid, { outcome, message }]) => ({ nodeid, outcome, message }));
    const runner = run.runnerId ? await this.runners.findOne({ where: { id: run.runnerId }, select: { id: true, name: true } }) : null;
    return {
      id: run.id,
      label: run.label,
      status: run.status,
      options: run.options,
      scope: run.scope,
      runner: runner ? { id: runner.id, name: runner.name } : null,
      environmentKey: run.environmentKey,
      stopRequested: run.stopRequested,
      // Its report opens by itself when it ends.
      reported: Boolean(run.scope && REPORTED.includes(run.scope.kind)),
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      exitCode: run.exitCode,
      total: tests.size,
      done: Object.keys(run.outcomes).length,
      counts,
      current,
      cases,
      problems,
    };
  }
}
