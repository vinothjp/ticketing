import { Module } from '@nestjs/common';
import { ApprovalsService } from './approvals.service';
import { ApprovalsController } from './approvals.controller';
import { TicketsModule } from '../tickets/tickets.module';
import { ActivityModule } from '../activity/activity.module';
import { MailModule } from '../mail/mail.module';
import { AssetsModule } from '../assets/assets.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [TicketsModule, ActivityModule, MailModule, AssetsModule, NotificationsModule],
  providers: [ApprovalsService],
  controllers: [ApprovalsController],
})
export class ApprovalsModule {}
