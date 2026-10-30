// The shape of GET /api/catalog.

export type TestCase = {
  key: string // the test case's permanent id in the database; results are stored against it
  id: string // "S1-01", "VFY-01"
  title: string
  given: string | null
  steps: string[]
  expected: string
  priority: string
  type: string
  req: string[]
  runAs: string
  detail: string | null
  areas: string[] // nodes of the split review files that show it, e.g. "admin-sellers/seller-workspace/notes"
  feature: string | null // the feature that added it
}

export type Scenario = {
  id: string // "S1", "VFY-S1"
  title: string
  role: string // as written in the file, e.g. "admin, biz_user"
  bizUser: boolean
  feature: string | null
  precondition: string
  path: string
  cases: TestCase[]
}

// One file that owns test cases.
export type Suite = {
  key: string
  kind: 'feature' | 'module'
  role: string // its role folder: admin | buyer | seller
  node: string // its place under the role folder, e.g. "admin-sellers/verified_tab"
  source: string
  title: string
  status: string
  coverage: string
  intro: string
  happyFlow: string
  setup: string
  scenarios: Scenario[]
}

// From a module.yml or feature.yml.
export type Folder = {
  kind: 'feature' | 'module'
  role: string
  path: string
  name: string
  status: string | null
  reqPrefix: string | null
}

export type Catalog = { suites: Suite[]; folders: Folder[] }

export type Result = 'pass' | 'fail'
export type Results = Record<string, Result>

// GET /api/runners: a runner agent on a tester's laptop, which runs the tests and login windows there.
export type RunnerInfo = {
  id: string
  name: string
  online: boolean
  lastSeenAt: string
  environment: { appUrl: string | null; branch: string | null; commit: string | null; dirty: boolean } | null
  environmentKey: string | null // the app its tests point at, e.g. "qa.done.deals"
  tests: number
  testsReason: string | null
}

// GET /api/results/environments: where results are kept apart, e.g. "qa.done.deals", "localhost:3000".
export type Environment = { key: string; results: number }

// GET /api/runs/automation?runner=: which test cases have automated tests in that runner's ai-qa.
export type Automation = {
  available: boolean
  reason: string | null // why tests can't be run on that runner, when they can't
  tests: number
  cases: Record<string, { tests: number; risky: number }> // risky: marked destructive or live_login
}

// What a run covered; runs with the same key are compared in reports.
export type RunScope = { kind: 'case' | 'scenario' | 'page' | 'filtered' | 'role'; key: string; name: string }

// A test case's place in a run.
export type CaseRunState = 'queued' | 'running' | 'pass' | 'fail' | 'skipped' | 'not run'

// GET /api/runs/current: the run going now on a runner, else its last one.
export type Run = {
  id: string
  label: string
  status: 'queued' | 'running' | 'finished' | 'stopped' | 'error' | 'interrupted'
  runner: { id: string; name: string } | null
  environmentKey: string | null
  stopRequested: boolean
  startedAt: string
  finishedAt: string | null
  exitCode: number | null
  total: number // tests
  done: number
  counts: Partial<Record<'passed' | 'failed' | 'error' | 'skipped' | 'xfailed' | 'xpassed', number>>
  current: string | null // node id of the test running now
  cases: Record<string, CaseRunState>
  problems: { nodeid: string; outcome: string; message: string | null }[]
  options: { includeDestructive: boolean; headed: boolean }
  scope: RunScope | null
  reported: boolean // its report opens by itself when it ends
  log?: string
}

// How a test case came out in a run, for reports.
export type CaseStatus = 'passed' | 'failed' | 'error' | 'skipped' | 'pending' | 'not run'

export type RunSummary = {
  cases: Record<CaseStatus, number>
  tests: number
  passRate: number | null // passed / (passed + failed + error)
  seconds: number
}

// GET /api/runs: past runs, newest first.
export type RunListItem = {
  id: string
  label: string
  status: Run['status']
  scope: RunScope | null
  options: Run['options']
  summary: RunSummary | null
  startedAt: string
  finishedAt: string | null
}

type CaseRef = { key: string; code: string; title: string; status: CaseStatus; was: CaseStatus }

// GET /api/runs/:id/report
export type Report = {
  run: {
    id: string
    label: string
    status: Run['status']
    scope: RunScope | null
    environment: { appUrl: string | null; branch: string | null; commit: string | null; dirty: boolean } | null
    runner: string | null // the laptop it ran on
    environmentKey: string | null
    options: Run['options']
    startedAt: string
    finishedAt: string | null
    exitCode: number | null
  }
  summary: RunSummary
  cases: {
    key: string
    code: string
    title: string
    priority: string
    scenario: { id: string; title: string }
    suite: { title: string; node: string }
    status: CaseStatus
    tests: {
      nodeid: string
      name: string
      outcome: string
      message: string | null
      seconds: number | null
      screenshots: { url: string; src: string | null }[] // src null: no longer kept
    }[]
  }[]
  scenarios: { id: string; title: string; suite: string; counts: Partial<Record<CaseStatus, number>> }[]
  comparison: {
    previous: { id: string; startedAt: string; label: string }
    newFailures: CaseRef[]
    fixed: CaseRef[]
    stillFailing: CaseRef[]
    newCases: number
  } | null
  trend: { id: string; startedAt: string; passRate: number | null; status: Run['status'] }[]
  slowest: { nodeid: string; name: string; seconds: number; code: string | null }[]
}

// GET /api/logins: the test suite's saved login per role, and any login window open for one.
export type LoginRole = 'buyer' | 'seller' | 'admin' | 'biz_user'
export type Logins = {
  available: boolean
  reason: string | null // why logins can't be saved on the runner, when they can't
  app: string | null // the app the sessions are for (QA or local)
  roles: {
    role: LoginRole
    savedAt: string | null
    loginUrl: string | null
    login: { status: 'waiting' | 'saving' | 'saved' | 'failed' | 'cancelled'; message: string | null } | null
  }[]
}
