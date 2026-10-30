import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type RunStatus = 'running' | 'finished' | 'stopped' | 'error' | 'interrupted';

// What pytest said about one test: passed | failed | error | skipped | xfailed | xpassed; how many
// seconds it took; and the screenshots kept from its failure (file names in the run's report folder).
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

// One pytest run started from the app.
@Entity('runs')
export class Run {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // What was run, as the app showed it: "STB-01", "STB-S1 Admin reviews…", "Star Buyers tab".
  @Column('text')
  label: string;

  @Column('text')
  status: RunStatus;

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

  // { <node id>: outcome }, filled in as tests finish.
  @Column('jsonb')
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
