import { BadRequestException, Body, Controller, ForbiddenException, Headers, Post } from '@nestjs/common';
import { SyncService, type SpecFile } from './sync.service';

@Controller('sync')
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  // For a backend that cannot see the specs folder: scripts/push-specs.mjs posts the test case files
  // here. Body: { files: [{ path: "specs/modules/<role>/<module>/test-cases.md", content }, …] }
  @Post()
  sync(@Headers('x-sync-token') token: string | undefined, @Body() body: { files?: unknown }) {
    const expected = process.env.SYNC_TOKEN;
    if (!expected || token !== expected) throw new ForbiddenException();

    const files = body?.files;
    const valid =
      Array.isArray(files) &&
      files.length > 0 &&
      files.every((file) => typeof file?.path === 'string' && typeof file?.content === 'string');
    if (!valid) throw new BadRequestException('files must be a non-empty list of { path, content }');
    return this.syncService.sync(files as SpecFile[]);
  }
}
