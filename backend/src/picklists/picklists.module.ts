import { Module } from '@nestjs/common';
import { PicklistsService } from './picklists.service';
import { PicklistsController } from './picklists.controller';

@Module({
  providers: [PicklistsService],
  controllers: [PicklistsController],
  exports: [PicklistsService],
})
export class PicklistsModule {}
