import { Module } from '@nestjs/common';
import { AssetsService } from './assets.service';
import { AssetsController } from './assets.controller';
import { AssetAllocationsService } from './asset-allocations.service';
import { AssetAllocationsController } from './asset-allocations.controller';

@Module({
  providers: [AssetsService, AssetAllocationsService],
  controllers: [AssetsController, AssetAllocationsController],
  // ApprovalsModule issues an asset when an asset request is approved, and needs
  // the same availability rule the allocation grid uses.
  exports: [AssetAllocationsService],
})
export class AssetsModule {}
