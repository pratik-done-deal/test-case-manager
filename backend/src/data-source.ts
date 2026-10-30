import 'dotenv/config';
import { DataSource, type DataSourceOptions } from 'typeorm';
import { Folder, Result, Scenario, Suite, TestCase } from './catalog/entities';
import { Mysql1770000000000 } from './database/migrations/1770000000000-mysql';
import { Runner } from './runners/runner.entity';
import { Run, RunTest, Screenshot } from './runs/run.entity';

export const dataSourceOptions: DataSourceOptions = {
  type: 'mysql',
  url: process.env.DATABASE_URL ?? 'mysql://test_manager:test_manager@127.0.0.1:3307/test_manager',
  // Dates are read and written as UTC.
  timezone: 'Z',
  // Comparisons follow each table's binary collation; the connection only needs utf8mb4.
  charset: 'utf8mb4',
  // Run reports and spec syncs can be large.
  extra: { connectionLimit: 10 },
  entities: [Suite, Scenario, TestCase, Result, Folder, Run, RunTest, Screenshot, Runner],
  migrations: [Mysql1770000000000],
};

// For `npm run migrate`: deploys that run migrations as their own step, before starting the backend.
export default new DataSource(dataSourceOptions);
