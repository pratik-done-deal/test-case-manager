import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { RunEnvironment } from './run.entity';
import { aiQaPython } from './test-index.service';

// Where reports keep the screenshots of their failures: <REPORTS_DIR>/<run id>/<file>. ai-qa's
// reports/screenshots is overwritten by every run, so each run keeps its own copies.
export const REPORTS_DIR = process.env.REPORTS_DIR
  ? resolve(process.env.REPORTS_DIR)
  : resolve(__dirname, '..', '..', 'storage', 'reports');

// Screenshots are kept for this long, and for at least the last KEEP_RUNS runs of the same thing.
export const KEEP_DAYS = 30;
export const KEEP_RUNS = 20;

const SAFE_FILE = /^[\w.-]+$/;

// Copies a test's screenshots into the run's folder; returns what was kept.
export function keepScreenshots(runId: string, index: number, shots: { url: string; path: string }[]) {
  const kept: { url: string; file: string }[] = [];
  for (const [n, shot] of shots.entries()) {
    if (!existsSync(shot.path)) continue;
    const file = `${index}-${n}-${basename(shot.path).replace(/[^\w.-]+/g, '_')}`;
    mkdirSync(join(REPORTS_DIR, runId), { recursive: true });
    copyFileSync(shot.path, join(REPORTS_DIR, runId, file));
    kept.push({ url: shot.url, file });
  }
  return kept;
}

// The kept screenshot's path, or null if the name isn't one of ours or it has been pruned.
export function screenshotPath(runId: string, file: string) {
  if (!SAFE_FILE.test(file)) return null;
  const path = join(REPORTS_DIR, runId, file);
  return existsSync(path) ? path : null;
}

// Removes the screenshots of runs that are neither recent nor among the last runs of their scope.
export function pruneScreenshots(runs: { id: string; scopeKey: string | null; startedAt: Date }[]) {
  if (!existsSync(REPORTS_DIR)) return 0;
  const cutoff = Date.now() - KEEP_DAYS * 86_400_000;
  const keep = new Set<string>();
  const seen = new Map<string, number>();
  for (const run of [...runs].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())) {
    const count = (seen.get(run.scopeKey ?? run.id) ?? 0) + 1;
    seen.set(run.scopeKey ?? run.id, count);
    if (run.startedAt.getTime() >= cutoff || count <= KEEP_RUNS) keep.add(run.id);
  }
  let removed = 0;
  for (const folder of readdirSync(REPORTS_DIR)) {
    if (keep.has(folder)) continue;
    rmSync(join(REPORTS_DIR, folder), { recursive: true, force: true });
    removed++;
  }
  return removed;
}

const run = (command: string, args: string[], cwd: string) =>
  new Promise<string | null>((done) =>
    execFile(command, args, { cwd, timeout: 10_000 }, (error, stdout) => done(error ? null : stdout.trim())),
  );

// The app ai-qa's settings point the tests at, and the branch and commit of the checkout.
export async function readEnvironment(dir: string): Promise<RunEnvironment> {
  const [appUrl, branch, commit, changes] = await Promise.all([
    run(aiQaPython(dir), ['-c', 'from config import settings; print(settings.app_url)'], dir),
    run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], dir),
    run('git', ['rev-parse', '--short', 'HEAD'], dir),
    run('git', ['status', '--porcelain'], dir),
  ]);
  return {
    appUrl: appUrl?.split('\n').pop() ?? null,
    branch,
    commit,
    dirty: Boolean(changes),
  };
}
