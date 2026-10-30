import 'dotenv/config';
import { DataSource, type DataSourceOptions } from 'typeorm';
import { Folder, Result, Scenario, Suite, TestCase } from './catalog/entities';
import { Init1760000000000 } from './database/migrations/1760000000000-init';
import { NestedSpecs1761000000000 } from './database/migrations/1761000000000-nested-specs';
import { Runs1762000000000 } from './database/migrations/1762000000000-runs';
import { RunReports1763000000000 } from './database/migrations/1763000000000-run-reports';
import { Deployable1764000000000 } from './database/migrations/1764000000000-deployable';
import { Runner } from './runners/runner.entity';
import { Run, RunTest, Screenshot } from './runs/run.entity';

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  url: process.env.DATABASE_URL ?? 'postgres://localhost:5432/test_manager',
  entities: [Suite, Scenario, TestCase, Result, Folder, Run, RunTest, Screenshot, Runner],
  migrations: [
    Init1760000000000,
    NestedSpecs1761000000000,
    Runs1762000000000,
    RunReports1763000000000,
    Deployable1764000000000,
  ],
};

// For `npm run migrate`: deploys that run migrations as their own step, before starting the backend.
export default new DataSource(dataSourceOptions);
