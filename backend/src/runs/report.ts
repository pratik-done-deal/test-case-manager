import type { CaseStatus, Run, RunSummary, TestOutcome } from './run.entity';

export const CASE_STATUSES: CaseStatus[] = ['passed', 'failed', 'error', 'skipped', 'pending', 'not run'];

// What a case's tests add up to. Failed: a check failed. Error: the test broke in setup or teardown
// (a fixture, a login, data it needed) before or after checking anything. Pending: only expected
// failures (pending_feature) and skips. Not run: the run ended before all its tests had.
export function caseStatus(outcomes: (TestOutcome | undefined)[]): CaseStatus {
  const seen = outcomes.map((outcome) => outcome?.outcome);
  if (seen.includes('failed')) return 'failed';
  if (seen.includes('error')) return 'error';
  if (seen.some((outcome) => !outcome)) return 'not run';
  if (seen.some((outcome) => outcome === 'passed' || outcome === 'xpassed')) return 'passed';
  if (seen.includes('xfailed')) return 'pending';
  return 'skipped';
}

export function caseStatuses(run: Run): Record<string, CaseStatus> {
  return Object.fromEntries(
    Object.entries(run.cases).map(([key, nodeids]) => [key, caseStatus(nodeids.map((nodeid) => run.outcomes[nodeid]))]),
  );
}

export function passRate(cases: Record<CaseStatus, number>) {
  const counted = cases.passed + cases.failed + cases.error;
  return counted ? cases.passed / counted : null;
}

export function summarize(run: Run): RunSummary {
  const cases = Object.fromEntries(CASE_STATUSES.map((status) => [status, 0])) as Record<CaseStatus, number>;
  for (const status of Object.values(caseStatuses(run))) cases[status]++;
  const end = run.finishedAt ?? new Date();
  return {
    cases,
    tests: new Set(Object.values(run.cases).flat()).size,
    passRate: passRate(cases),
    seconds: Math.round((end.getTime() - run.startedAt.getTime()) / 1000),
  };
}

const BAD: CaseStatus[] = ['failed', 'error'];

// Everything the report page shows about one run. screenshotUrl gives a kept screenshot's address, or
// null when it has been pruned.
export function buildReport(
  run: Run,
  previous: Run | null,
  trend: Run[],
  screenshotUrl: (run: Run, file: string) => string | null,
) {
  const statuses = caseStatuses(run);
  const summary = run.summary ?? summarize(run);

  const cases = Object.entries(run.cases).map(([key, nodeids]) => {
    const snapshot = run.snapshot[key];
    return {
      key,
      code: snapshot?.code ?? '?',
      title: snapshot?.title ?? 'A test case that no longer exists',
      priority: snapshot?.priority ?? '',
      scenario: snapshot?.scenario ?? { id: '', title: '' },
      suite: snapshot?.suite ?? { title: '', node: '' },
      status: statuses[key],
      tests: nodeids.map((nodeid) => {
        const outcome = run.outcomes[nodeid];
        const shots = outcome?.screenshots ?? [];
        return {
          nodeid,
          name: nodeid.split('::').pop() ?? nodeid,
          outcome: outcome?.outcome ?? 'not run',
          message: outcome?.message ?? null,
          seconds: outcome?.duration ?? null,
          screenshots: shots.map((shot) => ({ url: shot.url, src: screenshotUrl(run, shot.file) })),
        };
      }),
    };
  });

  // Scenarios in the order their cases came, with a count per status.
  const scenarios = new Map<string, { id: string; title: string; suite: string; counts: Record<string, number> }>();
  for (const testCase of cases) {
    const id = `${testCase.suite.node}/${testCase.scenario.id}`;
    const entry = scenarios.get(id) ?? {
      id: testCase.scenario.id,
      title: testCase.scenario.title,
      suite: testCase.suite.title,
      counts: {},
    };
    entry.counts[testCase.status] = (entry.counts[testCase.status] ?? 0) + 1;
    scenarios.set(id, entry);
  }

  let comparison = null;
  if (previous) {
    const before = caseStatuses(previous);
    const ref = (key: string) => {
      const found = cases.find((testCase) => testCase.key === key)!;
      return { key, code: found.code, title: found.title, status: found.status, was: before[key] };
    };
    const shared = Object.keys(statuses).filter((key) => key in before);
    comparison = {
      previous: { id: previous.id, startedAt: previous.startedAt, label: previous.label },
      newFailures: shared.filter((key) => BAD.includes(statuses[key]) && before[key] === 'passed').map(ref),
      fixed: shared.filter((key) => statuses[key] === 'passed' && BAD.includes(before[key])).map(ref),
      stillFailing: shared.filter((key) => BAD.includes(statuses[key]) && BAD.includes(before[key])).map(ref),
      newCases: Object.keys(statuses).filter((key) => !(key in before)).length,
    };
  }

  const slowest = Object.entries(run.outcomes)
    .filter(([, outcome]) => typeof outcome.duration === 'number')
    .sort(([, a], [, b]) => b.duration! - a.duration!)
    .slice(0, 5)
    .map(([nodeid, outcome]) => {
      const key = Object.keys(run.cases).find((caseKey) => run.cases[caseKey].includes(nodeid));
      return { nodeid, name: nodeid.split('::').pop() ?? nodeid, seconds: outcome.duration!, code: key ? run.snapshot[key]?.code : null };
    });

  return {
    run: {
      id: run.id,
      label: run.label,
      status: run.status,
      scope: run.scope,
      environment: run.environment,
      options: run.options,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      exitCode: run.exitCode,
    },
    summary,
    cases,
    scenarios: [...scenarios.values()],
    comparison,
    trend: trend.map((past) => ({
      id: past.id,
      startedAt: past.startedAt,
      passRate: (past.summary ?? summarize(past)).passRate,
      status: past.status,
    })),
    slowest,
  };
}
