import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogModule } from './catalog/catalog.module';
import { Folder, Result, Scenario, Suite, TestCase } from './catalog/entities';
import { Init1760000000000 } from './database/migrations/1760000000000-init';
import { NestedSpecs1761000000000 } from './database/migrations/1761000000000-nested-specs';
import { Runs1762000000000 } from './database/migrations/1762000000000-runs';
import { RunReports1763000000000 } from './database/migrations/1763000000000-run-reports';
import { EventsModule } from './events/events.module';
import { LoginsModule } from './logins/logins.module';
import { ResultsModule } from './results/results.module';
import { Run } from './runs/run.entity';
import { RunsModule } from './runs/runs.module';
import { SyncModule } from './sync/sync.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://localhost:5432/test_manager',
      entities: [Suite, Scenario, TestCase, Result, Folder, Run],
      migrations: [Init1760000000000, NestedSpecs1761000000000, Runs1762000000000, RunReports1763000000000],
      migrationsRun: true,
    }),
    EventsModule,
    CatalogModule,
    ResultsModule,
    SyncModule,
    RunsModule,
    LoginsModule,
  ],
})
export class AppModule {}
