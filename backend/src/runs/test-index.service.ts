import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { execFile } from 'node:child_process';
import { existsSync, FSWatcher, mkdtempSync, readFileSync, rmSync, watch } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { Subscription } from 'rxjs';
import { IsNull, Repository } from 'typeorm';
import { TestCase } from '../catalog/entities';
import { EventsService } from '../events/events.service';
import { touches } from '../sync/specs-watcher.service';
import { matchTests, RISKY_MARKERS, type CollectedTest } from './match-tests';

const DEBOUNCE_MS = 1000;
// Tests are collected again now and then, in case the file watcher missed a change.
const RECOLLECT_MS = 5 * 60_000;

// The pytest plugin that reports to the app; see runner/test_manager_plugin.py.
export const PLUGIN_DIR = resolve(__dirname, '..', '..', 'runner');

// Where ai-qa is checked out: AI_QA_DIR, else the folder above SPECS_DIR.
export function aiQaDir(): string | null {
  if (process.env.AI_QA_DIR) return resolve(process.env.AI_QA_DIR);
  if (process.env.SPECS_DIR) return resolve(process.env.SPECS_DIR, '..');
  return null;
}

// ai-qa's own virtualenv, which has pytest and Playwright installed.
export function aiQaPython(dir: string): string {
  return process.env.AI_QA_PYTHON ? resolve(process.env.AI_QA_PYTHON) : join(dir, '.venv', 'bin', 'python');
}

// Environment for a pytest process that loads the plugin.
export function pluginEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const pythonPath = [PLUGIN_DIR, process.env.PYTHONPATH].filter(Boolean).join(delimiter);
  return { ...process.env, PYTHONPATH: pythonPath, ...extra };
}

export type Automation = {
  available: boolean;
  reason: string | null; // why tests can't be run from here, when they can't
  tests: number;
  // { <test case id>: how many tests cover it, and how many of those change data }
  cases: Record<string, { tests: number; risky: number }>;
};

// Knows which ai-qa tests cover which test case. Collects the tests on start and again whenever a test
// file changes, and matches them to the cases again whenever the cases change.
@Injectable()
export class TestIndexService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(TestIndexService.name);
  private tests: CollectedTest[] = [];
  private risky = new Set<string>();
  private byCase = new Map<string, string[]>();
  private reason: string | null = 'Tests have not been collected yet';
  private watcher?: FSWatcher;
  private timer?: NodeJS.Timeout;
  private recollect?: NodeJS.Timeout;
  private subscription?: Subscription;
  private collecting: Promise<void> = Promise.resolve();

  constructor(
    @InjectRepository(TestCase) private readonly testCases: Repository<TestCase>,
    private readonly events: EventsService,
  ) {}

  async onApplicationBootstrap() {
    const dir = aiQaDir();
    if (!dir || !existsSync(join(dir, 'test_cases'))) {
      this.reason = 'The backend cannot see the ai-qa checkout (set AI_QA_DIR)';
      this.logger.warn(`${this.reason}; running tests from the app is off`);
      return;
    }
    this.subscription = this.events.changes.subscribe((event) => {
      if (event === 'catalog') void this.rematch();
    });
    await this.refresh();
    this.watchTests(join(dir, 'test_cases'));
    this.recollect = setInterval(() => {
      if (!this.watcher && existsSync(join(dir, 'test_cases'))) this.watchTests(join(dir, 'test_cases'));
      void this.refresh();
    }, RECOLLECT_MS);
  }

  // A .py file, or a folder (moving one reports only the folder), changes which tests there are.
  private watchTests(folder: string) {
    this.watcher = watch(folder, { recursive: true }, (_event, file) => {
      if (!touches(file, /\.py$/) || file?.includes('__pycache__')) return;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => void this.refresh(), DEBOUNCE_MS);
    });
    this.watcher.on('error', (error) => {
      this.logger.error(`Stopped watching ${folder}: ${error.message}; checking again every few minutes`);
      this.watcher?.close();
      this.watcher = undefined;
    });
  }

  onModuleDestroy() {
    clearTimeout(this.timer);
    clearInterval(this.recollect);
    this.watcher?.close();
    this.subscription?.unsubscribe();
  }

  getAutomation(): Automation {
    const cases: Automation['cases'] = {};
    for (const [key, nodeids] of this.byCase) {
      cases[key] = { tests: nodeids.length, risky: nodeids.filter((nodeid) => this.risky.has(nodeid)).length };
    }
    return { available: !this.reason, reason: this.reason, tests: this.tests.length, cases };
  }

  get unavailableReason() {
    return this.reason;
  }

  testsFor(testCaseId: string): string[] {
    return this.byCase.get(testCaseId) ?? [];
  }

  isRisky(nodeid: string) {
    return this.risky.has(nodeid);
  }

  // One collection at a time; a change during one is picked up by the next.
  refresh(): Promise<void> {
    this.collecting = this.collecting.then(() => this.collect()).then(() => this.rematch());
    return this.collecting;
  }

  private async collect() {
    const dir = aiQaDir()!;
    const python = aiQaPython(dir);
    if (!existsSync(python)) {
      this.reason = `No Python at ${python} (set AI_QA_PYTHON)`;
      this.logger.warn(this.reason);
      return;
    }
    const scratch = mkdtempSync(join(tmpdir(), 'test-manager-collect-'));
    const out = join(scratch, 'tests.json');
    try {
      // addopts is cleared so collecting doesn't wipe ai-qa's last HTML and Allure reports.
      await new Promise<void>((done, fail) =>
        execFile(
          python,
          ['-m', 'pytest', '--collect-only', '-q', '-p', 'test_manager_plugin', '-o', 'addopts='],
          { cwd: dir, env: pluginEnv({ TM_COLLECT_OUT: out }), maxBuffer: 64 * 1024 * 1024 },
          (error, _stdout, stderr) => {
            if (existsSync(out)) done();
            else fail(new Error(`pytest could not collect the tests: ${stderr.trim() || error?.message}`));
          },
        ),
      );
      this.tests = JSON.parse(readFileSync(out, 'utf8'));
      this.risky = new Set(
        this.tests.filter((test) => test.markers.some((m) => RISKY_MARKERS.includes(m))).map((test) => test.nodeid),
      );
      this.reason = null;
      this.logger.log(`Collected ${this.tests.length} tests`);
    } catch (error) {
      this.reason = error instanceof Error ? error.message : String(error);
      this.logger.error(this.reason);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }

  private async rematch() {
    if (!this.tests.length) {
      this.byCase = new Map();
    } else {
      const rows = await this.testCases.find({
        where: { archivedAt: IsNull(), scenario: { archivedAt: IsNull(), suite: { archivedAt: IsNull() } } },
        relations: { scenario: { suite: true } },
      });
      const cases = rows.map((row) => ({
        key: row.id,
        code: row.code,
        req: row.req,
        kind: row.scenario.suite.kind,
        role: row.scenario.suite.role,
        node: row.scenario.suite.node,
        areas: row.areas,
      }));
      this.byCase = matchTests(this.tests, cases);
      this.logger.log(`${this.byCase.size} of ${cases.length} test cases have automated tests`);
    }
    this.events.emit('automation');
  }
}
