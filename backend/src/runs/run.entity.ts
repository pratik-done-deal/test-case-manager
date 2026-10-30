import { Column, CreateDateColumn, Entity, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';

// queued: waiting for its runner to pick it up.
export type RunStatus = 'queued' | 'running' | 'finished' | 'stopped' | 'error' | 'interrupted';

// What pytest said about one test: passed | failed | error | skipped | xfailed | xpassed; how many
// seconds it took; and the screenshots kept from its failure (file names in the screenshots table).
export type TestOutcome = {
  outcome: string;
  message: string | null;
  duration?: number;
  screenshots?: { url: string; file: string }[];
};

// What a run covered, so runs of the same thing can be compared. key is stable across runs:
// "page:#/buyer/buyer-cue-card", "scenario:<suite id>/S6", "role:buyer", "case:<test case id>".
export type RunScope = { kind: 'case' | 'scenario' | 'page' | 'filtered' | 'role'; key: string; name: string };

// Where the run ran: the app the tests opened, and the ai-qa checkout they came from.
export type RunEnvironment = { appUrl: string | null; branch: string | null; commit: string | null; dirty: boolean };

// A case as it read when the run started, so an old report still shows it after it is renumbered.
export type CaseSnapshot = {
  code: string;
  title: string;
  priority: string;
  scenario: { id: string; title: string };
  suite: { title: string; node: string };
};

// Test case results of a finished run, for the history list and the comparison with the next run.
export type RunSummary = {
  cases: Record<CaseStatus, number>;
  tests: number;
  passRate: number | null; // passed / (passed + failed + error); skipped and pending don't count
  seconds: number;
};

export type CaseStatus = 'passed' | 'failed' | 'error' | 'skipped' | 'pending' | 'not run';

// One pytest run started from the app, run by the runner agent on a tester's laptop.
@Entity('runs')
export class Run {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // What was run, as the app showed it: "STB-01", "STB-S1 Admin reviews…", "Star Buyers tab".
  @Column('text')
  label: string;

  @Column('text')
  status: RunStatus;

  @Column('uuid', { name: 'runner_id', nullable: true })
  runnerId: string | null;

  // The app the tests point at, e.g. "qa.done.deals": the environment its results are kept under.
  @Column('text', { name: 'environment_key', nullable: true })
  environmentKey: string | null;

  // Stop was pressed; the runner ends pytest when it next reports.
  @Column('boolean', { name: 'stop_requested', default: false })
  stopRequested: boolean;

  // When the runner last reported on it; a running run that goes quiet was interrupted.
  @Column('timestamptz', { name: 'heartbeat_at', nullable: true })
  heartbeatAt: Date | null;

  // The node id of the test running now.
  @Column('text', { name: 'current_test', nullable: true })
  currentTest: string | null;

  @Column('jsonb')
  options: { includeDestructive: boolean; headed: boolean };

  @Column('jsonb', { nullable: true })
  scope: RunScope | null;

  @Column('jsonb', { nullable: true })
  environment: RunEnvironment | null;

  // { <test case id>: [node ids of its tests] }
  @Column('jsonb')
  cases: Record<string, string[]>;

  // { <test case id>: the case as it read at the start }
  @Column('jsonb')
  snapshot: Record<string, CaseSnapshot>;

  // { <node id>: outcome }, filled in as tests finish. Stored as run_tests rows; loaded by RunsService.
  outcomes: Record<string, TestOutcome>;

  @Column('jsonb', { nullable: true })
  summary: RunSummary | null;

  // The end of pytest's output.
  @Column('text')
  log: string;

  @Column('int', { name: 'exit_code', nullable: true })
  exitCode: number | null;

  @Column('timestamptz', { name: 'started_at' })
  startedAt: Date;

  @Column('timestamptz', { name: 'finished_at', nullable: true })
  finishedAt: Date | null;
}

// What pytest said about one test of a run.
@Entity('run_tests')
export class RunTest {
  @PrimaryColumn('uuid', { name: 'run_id' })
  runId: string;

  @PrimaryColumn('text')
  nodeid: string;

  // The order the tests finished in.
  @Column('int')
  position: number;

  @Column('text')
  outcome: string;

  @Column('text', { nullable: true })
  message: string | null;

  @Column('real', { nullable: true })
  duration: number | null;

  @Column('jsonb')
  screenshots: { url: string; file: string }[];
}

// A failure screenshot kept with its run, since the runner's own copies are overwritten by every run.
@Entity('screenshots')
export class Screenshot {
  @PrimaryColumn('uuid', { name: 'run_id' })
  runId: string;

  @PrimaryColumn('text')
  file: string;

  @Column('text', { name: 'content_type' })
  contentType: string;

  @Column('bytea')
  data: Buffer;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
