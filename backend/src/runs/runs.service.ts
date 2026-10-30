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
import { InjectRepository } from '@nestjs/typeorm';
import { ChildProcess, spawn } from 'node:child_process';
import { closeSync, existsSync, mkdtempSync, openSync, readSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { In, IsNull, Repository } from 'typeorm';
import { Result, TestCase } from '../catalog/entities';
import { EventsService } from '../events/events.service';
import { buildReport, summarize } from './report';
import { keepScreenshots, pruneScreenshots, readEnvironment, screenshotPath } from './report-store';
import { Run, type RunScope, type RunStatus, type TestOutcome } from './run.entity';
import { aiQaDir, aiQaPython, pluginEnv, TestIndexService } from './test-index.service';

const TICK_MS = 700;
const LOG_LIMIT = 200_000;
const KILL_AFTER_MS = 5000;

export type StartRun = {
  label: string;
  testCaseKeys: string[];
  includeDestructive: boolean;
  headed: boolean;
  scope: RunScope | null;
};

// Runs whose report opens by itself when they end: more than a single case.
const REPORTED: RunScope['kind'][] = ['scenario', 'page', 'filtered', 'role'];

type Active = {
  run: Run;
  child: ChildProcess;
  scratch: string;
  events: string;
  offset: number;
  partial: string;
  current: string | null; // the test running now
  stopping: boolean;
  dirty: boolean;
  timer: NodeJS.Timeout;
  ticking: Promise<void>;
};

// A case passes when its tests ran and none failed. Skipped and expected-failure (pending feature)
// tests say nothing about it, so a case with only those keeps the result it had.
function caseResult(outcomes: string[]): 'pass' | 'fail' | null {
  if (outcomes.some((outcome) => outcome === 'failed' || outcome === 'error')) return 'fail';
  if (outcomes.some((outcome) => outcome === 'passed' || outcome === 'xpassed')) return 'pass';
  return null;
}

// Runs the tests of the chosen test cases with ai-qa's pytest, one run at a time, and records each
// case's pass / fail as soon as its last test is done.
@Injectable()
export class RunsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RunsService.name);
  private active: Active | null = null;

  constructor(
    @InjectRepository(Run) private readonly runs: Repository<Run>,
    @InjectRepository(Result) private readonly results: Repository<Result>,
    @InjectRepository(TestCase) private readonly testCases: Repository<TestCase>,
    private readonly index: TestIndexService,
    private readonly events: EventsService,
  ) {}

  // A run that was going when the backend stopped can't be followed any more. Runs from before reports
  // existed get their summary.
  async onApplicationBootstrap() {
    await this.runs.update({ status: 'running' }, { status: 'interrupted', finishedAt: new Date() });
    for (const run of await this.runs.find({ where: { summary: IsNull() } })) {
      await this.runs.update(run.id, { summary: summarize(run) });
    }
  }

  onModuleDestroy() {
    if (this.active) this.kill(this.active, 'SIGKILL');
  }

  // The run going now, else the last one; with what the app shows about it. Its output only when asked,
  // since pages refetch this on every step of a run.
  async current(withLog: boolean) {
    const run = this.active?.run ?? (await this.runs.findOne({ where: {}, order: { startedAt: 'DESC' } }));
    if (!run) return null;
    const described = this.describe(run);
    return withLog ? { ...described, log: run.log } : described;
  }

  async start({ label, testCaseKeys, includeDestructive, headed, scope }: StartRun) {
    if (this.active) throw new ConflictException('A run is already going; stop it or wait for it to end');
    const dir = aiQaDir();
    const reason = this.index.unavailableReason;
    if (!dir || reason) throw new ServiceUnavailableException(reason ?? 'Tests cannot be run from here');

    const cases: Record<string, string[]> = {};
    for (const key of new Set(testCaseKeys)) {
      const nodeids = this.index.testsFor(key).filter((nodeid) => includeDestructive || !this.index.isRisky(nodeid));
      if (nodeids.length) cases[key] = nodeids;
    }
    const nodeids = [...new Set(Object.values(cases).flat())];
    if (!nodeids.length) throw new BadRequestException('None of these test cases has a test that can run');

    const snapshot = await this.snapshot(Object.keys(cases));

    const run = await this.runs.save(
      this.runs.create({
        label,
        status: 'running',
        options: { includeDestructive, headed },
        scope,
        environment: null,
        cases,
        snapshot,
        summary: null,
        outcomes: {},
        log: '',
        exitCode: null,
        startedAt: new Date(),
        finishedAt: null,
      }),
    );

    const scratch = mkdtempSync(join(tmpdir(), 'test-manager-run-'));
    const select = join(scratch, 'select.txt');
    const events = join(scratch, 'events.jsonl');
    writeFileSync(select, nodeids.join('\n'));
    writeFileSync(events, '');
    // Only the files of the chosen tests are collected; the plugin then keeps just the chosen tests.
    const files = [...new Set(nodeids.map((nodeid) => nodeid.split('::')[0]))];
    const args = ['-m', 'pytest', '-p', 'test_manager_plugin', ...(headed ? ['--headed'] : []), ...files];
    // Its own process group, so Stop also ends the browsers it opened.
    const child = spawn(aiQaPython(dir), args, {
      cwd: dir,
      env: pluginEnv({ TM_SELECT: select, TM_EVENTS_OUT: events, PYTHONUNBUFFERED: '1' }),
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const active: Active = {
      run,
      child,
      scratch,
      events,
      offset: 0,
      partial: '',
      current: null,
      stopping: false,
      dirty: true,
      timer: setInterval(() => void this.tick(active), TICK_MS),
      ticking: Promise.resolve(),
    };
    this.active = active;

    const append = (chunk: Buffer) => {
      run.log = (run.log + chunk.toString()).slice(-LOG_LIMIT);
      active.dirty = true;
    };
    child.stdout!.on('data', append);
    child.stderr!.on('data', append);
    child.on('error', (error) => append(Buffer.from(`\n${error.message}\n`)));
    child.on('close', (code) => void this.finish(active, code));

    // Read alongside the run; it is only for the report.
    void readEnvironment(dir).then(async (environment) => {
      run.environment = environment;
      await this.runs.update(run.id, { environment });
    });

    this.logger.log(`Run ${run.id}: ${nodeids.length} tests for ${Object.keys(cases).length} test cases (${label})`);
    this.events.emit('runs');
    return this.describe(run);
  }

  async stop(id: string) {
    const active = this.active;
    if (!active || active.run.id !== id) throw new NotFoundException('That run is not going');
    active.stopping = true;
    this.kill(active, 'SIGTERM');
    setTimeout(() => {
      if (this.active === active) this.kill(active, 'SIGKILL');
    }, KILL_AFTER_MS).unref();
    return this.describe(active.run);
  }

  private kill(active: Active, signal: NodeJS.Signals) {
    try {
      process.kill(-active.child.pid!, signal);
    } catch {
      active.child.kill(signal);
    }
  }

  // One tick at a time, so a slow save never overlaps the next read.
  private tick(active: Active) {
    active.ticking = active.ticking.then(() => this.readOutcomes(active)).catch((error) => {
      this.logger.error('Could not record run progress', error instanceof Error ? error.stack : String(error));
    });
    return active.ticking;
  }

  // Reads the outcomes pytest has written since the last tick, records the results of the cases that
  // are now complete, and tells open pages.
  private async readOutcomes(active: Active) {
    const run = active.run;
    const done: string[] = [];
    if (existsSync(active.events)) {
      const fd = openSync(active.events, 'r');
      try {
        const buffer = Buffer.alloc(64 * 1024);
        let read: number;
        while ((read = readSync(fd, buffer, 0, buffer.length, active.offset)) > 0) {
          active.offset += read;
          active.partial += buffer.subarray(0, read).toString();
        }
      } finally {
        closeSync(fd);
      }
      const lines = active.partial.split('\n');
      active.partial = lines.pop() ?? '';
      for (const line of lines.filter(Boolean)) {
        const event = JSON.parse(line) as { nodeid: string; event: string; outcome: string; message: string | null } & {
          duration?: number;
          screenshots?: { url: string; path: string }[];
        };
        if (event.event === 'start') {
          active.current = event.nodeid;
        } else {
          // Copied now: the next test, or the next run, may write over ai-qa's copies.
          const screenshots = event.screenshots?.length
            ? keepScreenshots(run.id, Object.keys(run.outcomes).length, event.screenshots)
            : [];
          const outcome: TestOutcome = { outcome: event.outcome, message: event.message, duration: event.duration };
          if (screenshots.length) outcome.screenshots = screenshots;
          run.outcomes[event.nodeid] = outcome;
          if (active.current === event.nodeid) active.current = null;
          done.push(event.nodeid);
        }
        active.dirty = true;
      }
    }

    if (done.length) {
      const finished = new Set(done);
      const updates: { testCaseId: string; status: 'pass' | 'fail' }[] = [];
      for (const [key, nodeids] of Object.entries(run.cases)) {
        if (!nodeids.some((nodeid) => finished.has(nodeid))) continue;
        if (!nodeids.every((nodeid) => run.outcomes[nodeid])) continue;
        const status = caseResult(nodeids.map((nodeid) => run.outcomes[nodeid].outcome));
        if (status) updates.push({ testCaseId: key, status });
      }
      if (updates.length) {
        // A case archived while the run went on has no row to hang a result on any more.
        const live = await this.testCases.find({
          select: { id: true },
          where: { id: In(updates.map((update) => update.testCaseId)) },
        });
        const ids = new Set(live.map((row) => row.id));
        await this.results.save(updates.filter((update) => ids.has(update.testCaseId)));
        this.events.emit('results');
      }
    }

    if (active.dirty) {
      active.dirty = false;
      await this.runs.update(run.id, { outcomes: run.outcomes, log: run.log });
      this.events.emit('runs');
    }
  }

  private async finish(active: Active, code: number | null) {
    clearInterval(active.timer);
    await this.tick(active);
    const run = active.run;
    // pytest exits 0 when all passed and 1 when some failed; anything else means it could not run them.
    const status: RunStatus = active.stopping ? 'stopped' : code === 0 || code === 1 ? 'finished' : 'error';
    run.status = status;
    run.exitCode = code;
    run.finishedAt = new Date();
    run.summary = summarize(run);
    await this.runs.update(run.id, {
      status,
      exitCode: code,
      finishedAt: run.finishedAt,
      outcomes: run.outcomes,
      log: run.log,
      summary: run.summary,
    });
    await this.prune();
    rmSync(active.scratch, { recursive: true, force: true });
    this.active = null;
    this.logger.log(`Run ${run.id} ${status} (exit ${code})`);
    this.events.emit('runs');
  }

  // Every run with its summary, newest first; only those of one scope when given.
  async history(scopeKey: string | undefined, limit: number) {
    const query = this.runs
      .createQueryBuilder('run')
      .select(['run.id', 'run.label', 'run.status', 'run.scope', 'run.options', 'run.summary', 'run.startedAt', 'run.finishedAt'])
      .where('run.status != :running', { running: 'running' })
      .orderBy('run.startedAt', 'DESC')
      .limit(limit);
    if (scopeKey) query.andWhere(`run.scope ->> 'key' = :scopeKey`, { scopeKey });
    return query.getMany();
  }

  // The report of one run: compared with the previous run of the same thing, with its trend.
  async report(id: string) {
    const run = this.active?.run.id === id ? this.active.run : await this.runs.findOneBy({ id });
    if (!run) throw new NotFoundException('No such run');
    // Runs from before reports have no snapshot: the cases as they read now are the best there is.
    const missing = Object.keys(run.cases).filter((key) => !run.snapshot[key]);
    if (missing.length) {
      run.snapshot = { ...run.snapshot, ...(await this.snapshot(missing)) };
      if (run.status !== 'running') await this.runs.update(run.id, { snapshot: run.snapshot });
    }
    let previous: Run | null = null;
    let trend: Run[] = [run];
    if (run.scope?.key) {
      const earlier = await this.runs
        .createQueryBuilder('run')
        .where(`run.scope ->> 'key' = :key`, { key: run.scope.key })
        .andWhere('run.startedAt < :startedAt', { startedAt: run.startedAt })
        .andWhere('run.status IN (:...statuses)', { statuses: ['finished', 'stopped'] })
        .orderBy('run.startedAt', 'DESC')
        .limit(9)
        .getMany();
      previous = earlier[0] ?? null;
      trend = [...earlier.reverse(), run];
    }
    return buildReport(run, previous, trend, (of, file) =>
      screenshotPath(of.id, file) ? `/runs/${of.id}/screenshots/${encodeURIComponent(file)}` : null,
    );
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

  async log(id: string) {
    const run = this.active?.run.id === id ? this.active.run : await this.runs.findOne({ where: { id }, select: { id: true, log: true } });
    if (!run) throw new NotFoundException('No such run');
    return run.log;
  }

  screenshot(id: string, file: string) {
    const path = screenshotPath(id, file);
    if (!path) throw new NotFoundException('That screenshot is not kept any more');
    return path;
  }

  private async prune() {
    try {
      const rows = await this.runs.find({ select: { id: true, scope: true, startedAt: true } });
      const removed = pruneScreenshots(
        rows.map((row) => ({ id: row.id, scopeKey: row.scope?.key ?? null, startedAt: row.startedAt })),
      );
      if (removed) this.logger.log(`Removed the screenshots of ${removed} old runs`);
    } catch (error) {
      this.logger.error('Could not prune screenshots', error instanceof Error ? error.stack : String(error));
    }
  }

  private describe(run: Run) {
    const counts: Record<string, number> = {};
    for (const { outcome } of Object.values(run.outcomes)) counts[outcome] = (counts[outcome] ?? 0) + 1;
    const tests = new Set(Object.values(run.cases).flat());
    // { <test case id>: queued | running | pass | fail | skipped }
    const cases: Record<string, string> = {};
    const current = this.active?.run === run ? this.active.current : null;
    for (const [key, nodeids] of Object.entries(run.cases)) {
      const outcomes = nodeids.map((nodeid) => run.outcomes[nodeid]?.outcome);
      if (outcomes.every(Boolean)) cases[key] = caseResult(outcomes as string[]) ?? 'skipped';
      else if (run.status !== 'running') cases[key] = 'not run';
      else if (current && nodeids.includes(current)) cases[key] = 'running';
      else if (outcomes.some(Boolean)) cases[key] = 'running';
      else cases[key] = 'queued';
    }
    const problems = Object.entries(run.outcomes)
      .filter(([, { outcome }]) => outcome === 'failed' || outcome === 'error')
      .map(([nodeid, { outcome, message }]) => ({ nodeid, outcome, message }));
    return {
      id: run.id,
      label: run.label,
      status: run.status,
      options: run.options,
      scope: run.scope,
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
