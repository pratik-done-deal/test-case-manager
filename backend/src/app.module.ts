import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogModule } from './catalog/catalog.module';
import { dataSourceOptions } from './data-source';
import { EventsModule } from './events/events.module';
import { HealthController } from './health.controller';
import { LoginsModule } from './logins/logins.module';
import { ResultsModule } from './results/results.module';
import { RunnersModule } from './runners/runners.module';
import { RunsModule } from './runs/runs.module';
import { SyncModule } from './sync/sync.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      ...dataSourceOptions,
      // MIGRATIONS_RUN=false when migrations run as their own deploy step (npm run migrate).
      migrationsRun: process.env.MIGRATIONS_RUN !== 'false',
    }),
    EventsModule,
    CatalogModule,
    ResultsModule,
    SyncModule,
    RunsModule,
    RunnersModule,
    LoginsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
