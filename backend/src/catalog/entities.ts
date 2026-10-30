import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// One markdown file that owns test cases (not a review copy of another file's cases).
@Entity('suites')
export class Suite {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('text')
  kind: 'feature' | 'module';

  // The role folder it sits in: admin | buyer | seller.
  @Column('text')
  role: string;

  // Its place under the role folder: "admin-sellers/seller-workspace", "admin-sellers/shared/row-links-actions".
  @Column('text')
  node: string;

  // The last part of node; recognises a file that moved to another folder.
  @Column('text')
  slug: string;

  @Column('text')
  title: string;

  @Column('text')
  status: string;

  @Column('text')
  coverage: string;

  @Column('text')
  source: string;

  @Column('text')
  intro: string;

  @Column('text', { name: 'happy_flow' })
  happyFlow: string;

  // What section 3 says before its first scenario: the test data key.
  @Column('text')
  setup: string;

  // Set when the file is no longer in the specs folder. Rows are kept so results survive a return.
  @Column('timestamptz', { name: 'archived_at', nullable: true })
  archivedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @OneToMany(() => Scenario, (scenario) => scenario.suite)
  scenarios: Scenario[];
}

@Entity('scenarios')
export class Scenario {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'suite_id' })
  suiteId: string;

  @ManyToOne(() => Suite, (suite) => suite.scenarios, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'suite_id' })
  suite: Suite;

  // "S1"
  @Column('text')
  code: string;

  @Column('text')
  title: string;

  // As written in the file, e.g. "buyer (corporate)".
  @Column('text')
  role: string;

  // The role folder of its file.
  @Column('text', { name: 'role_key' })
  roleKey: string;

  // Its Role line names biz_user, so the app also lists it under Biz User.
  @Column('boolean', { name: 'biz_user' })
  bizUser: boolean;

  // From a "**Feature:** <slug> (pending)" line.
  @Column('text', { nullable: true })
  feature: string | null;

  @Column('text')
  precondition: string;

  @Column('text')
  path: string;

  @Column('int')
  position: number;

  @Column('timestamptz', { name: 'archived_at', nullable: true })
  archivedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @OneToMany(() => TestCase, (testCase) => testCase.scenario)
  cases: TestCase[];
}

@Entity('test_cases')
export class TestCase {
  // Permanent: results hang off this id, so it survives the case being renumbered or reworded.
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'scenario_id' })
  scenarioId: string;

  @ManyToOne(() => Scenario, (scenario) => scenario.cases, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'scenario_id' })
  scenario: Scenario;

  // "S1-01"
  @Column('text')
  code: string;

  @Column('text')
  title: string;

  @Column('text', { nullable: true })
  given: string | null;

  @Column('jsonb')
  steps: string[];

  @Column('text')
  expected: string;

  @Column('text')
  priority: string;

  @Column('text')
  type: string;

  @Column('jsonb')
  req: string[];

  @Column('text', { name: 'run_as' })
  runAs: string;

  @Column('text', { nullable: true })
  detail: string | null;

  // The nodes of the split review files that show this case, e.g. "admin-sellers/seller-workspace/notes".
  @Column('jsonb')
  areas: string[];

  // The feature that added it: its scenario's Feature line, or a requirement id with the feature's prefix.
  @Column('text', { nullable: true })
  feature: string | null;

  @Column('int')
  position: number;

  @Column('timestamptz', { name: 'archived_at', nullable: true })
  archivedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

// The current pass / fail of a test case on one environment (the app the tests point at, e.g.
// "qa.done.deals"). No row means not run there.
@Entity('results')
export class Result {
  @PrimaryColumn('uuid', { name: 'test_case_id' })
  testCaseId: string;

  @PrimaryColumn('text')
  environment: string;

  @ManyToOne(() => TestCase, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'test_case_id' })
  testCase: TestCase;

  @Column('text')
  status: 'pass' | 'fail';

  // "manual", or the id of the run that set it.
  @Column('text')
  source: string;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

// A module.yml or feature.yml: the name and status of a folder.
@Entity('folders')
export class Folder {
  @PrimaryColumn('text')
  kind: 'feature' | 'module';

  @PrimaryColumn('text')
  role: string;

  // Under the role folder: "admin-sellers", "admin-sellers/seller-workspace", "seller-qa".
  @PrimaryColumn('text')
  path: string;

  @Column('text')
  name: string;

  @Column('text', { nullable: true })
  status: string | null;

  @Column('text', { name: 'req_prefix', nullable: true })
  reqPrefix: string | null;
}
