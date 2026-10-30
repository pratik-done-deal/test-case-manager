// Screenshots are kept for this long, and for at least the last KEEP_RUNS runs of the same thing.
export const KEEP_DAYS = 30;
export const KEEP_RUNS = 20;

const SAFE_FILE = /^[\w.-]+$/;

// Whether a screenshot name is one of ours: <position>-<n>-<name>.
export const isSafeFile = (file: string) => SAFE_FILE.test(file);

// The stored name of a test's nth screenshot: unique within the run, safe in a URL.
export function screenshotFile(position: number, n: number, name: string) {
  return `${position}-${n}-${name.replace(/[^\w.-]+/g, '_')}`.slice(0, 200);
}

export function contentTypeOf(file: string) {
  const extension = file.split('.').pop()?.toLowerCase();
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'webp') return 'image/webp';
  return 'image/png';
}

// The runs whose screenshots are kept: recent ones and the last runs of each scope.
export function runsToKeep(runs: { id: string; scopeKey: string | null; startedAt: Date }[]) {
  const cutoff = Date.now() - KEEP_DAYS * 86_400_000;
  const keep = new Set<string>();
  const seen = new Map<string, number>();
  for (const run of [...runs].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())) {
    const count = (seen.get(run.scopeKey ?? run.id) ?? 0) + 1;
    seen.set(run.scopeKey ?? run.id, count);
    if (run.startedAt.getTime() >= cutoff || count <= KEEP_RUNS) keep.add(run.id);
  }
  return keep;
}
