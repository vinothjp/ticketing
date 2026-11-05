import { Module } from '@nestjs/common';
import { AssetsService } from './assets.service';
import { AssetsController } from './assets.controller';
import { AssetAllocationsService } from './asset-allocations.service';
import { AssetAllocationsController } from './asset-allocations.controller';
import { AssetActivityService } from './asset-activity.service';
import { AssetActivityController } from './asset-activity.controller';

@Module({
  providers: [AssetsService, AssetAllocationsService, AssetActivityService],
  controllers: [AssetsController, AssetAllocationsController, AssetActivityController],
  // ApprovalsModule issues an asset when an asset request is approved, and needs
  // the same availability rule the allocation grid uses.
  exports: [AssetAllocationsService],
})
export class AssetsModule {}
