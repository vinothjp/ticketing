import { Module } from '@nestjs/common';
import { ChangeRequestsController } from './change-requests.controller';
import { ChangeRequestsService } from './change-requests.service';
import { CrOptionsService } from './cr-options.service';
import { CrAttachmentsService } from './cr-attachments.service';

@Module({
  controllers: [ChangeRequestsController],
  providers: [ChangeRequestsService, CrOptionsService, CrAttachmentsService],
})
export class ChangeRequestsModule {}
