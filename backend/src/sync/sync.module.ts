import { Module } from '@nestjs/common';
import { SpecsWatcher } from './specs-watcher.service';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';

@Module({
  controllers: [SyncController],
  providers: [SyncService, SpecsWatcher],
})
export class SyncModule {}
