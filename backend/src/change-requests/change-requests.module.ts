import { Module } from '@nestjs/common';
import { ChangeRequestsController } from './change-requests.controller';
import { MyChangeRequestsController } from './my-change-requests.controller';
import { ChangeRequestsService } from './change-requests.service';
import { CrOptionsService } from './cr-options.service';
import { CrAttachmentsService } from './cr-attachments.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [ChangeRequestsController, MyChangeRequestsController],
  providers: [ChangeRequestsService, CrOptionsService, CrAttachmentsService],
})
export class ChangeRequestsModule {}
