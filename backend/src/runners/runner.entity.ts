import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import type { CollectedTest } from '../runs/match-tests';
import type { RunEnvironment } from '../runs/run.entity';

export const ROLES = ['buyer', 'seller', 'admin', 'biz_user'] as const;
export type Role = (typeof ROLES)[number];

// waiting: the login browser is open. saving: Save was pressed. saved / failed / cancelled: it ended.
export type LoginStatus = 'waiting' | 'saving' | 'saved' | 'failed' | 'cancelled';

// Each role's saved session on the runner's ai-qa checkout and any login window open there, as the
// runner reports it. The app shows it as it is.
export type RunnerLogins = {
  available: boolean;
  reason: string | null;
  app: string | null;
  roles: {
    role: Role;
    savedAt: string | null;
    loginUrl: string | null;
    login: { status: LoginStatus; message: string | null } | null;
  }[];
};

// Something the app asked the runner to do with a login window; handed out on its next poll.
export type RunnerCommand = { kind: 'login' | 'save' | 'cancel'; role: Role };

// The runner agent on a tester's laptop: it runs the tests and login windows next to that laptop's
// ai-qa checkout.
@Entity('runners')
export class Runner {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // RUNNER_NAME on the laptop, e.g. "pratik-mac".
  @Column('varchar', { length: 100, unique: true })
  name: string;

  @Column('datetime', { precision: 3, name: 'last_seen_at' })
  lastSeenAt: Date;

  // The app its ai-qa settings point at, and the branch and commit of its checkout.
  @Column('json', { nullable: true })
  environment: RunEnvironment | null;

  // The ai-qa tests it collected; which test cases they cover is worked out here.
  @Column('json')
  tests: CollectedTest[];

  // Why it could not collect its tests, when it couldn't.
  @Column('text', { name: 'tests_reason', nullable: true })
  testsReason: string | null;

  @Column('datetime', { precision: 3, name: 'tests_at', nullable: true })
  testsAt: Date | null;

  @Column('json', { nullable: true })
  logins: RunnerLogins | null;

  @Column('json')
  commands: RunnerCommand[];

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt: Date;
}
