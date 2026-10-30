import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { Folder, Suite } from './entities';

@Module({
  imports: [TypeOrmModule.forFeature([Suite, Folder])],
  controllers: [CatalogController],
  providers: [CatalogService],
})
export class CatalogModule {}
