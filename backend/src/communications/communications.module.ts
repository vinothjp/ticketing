import { Module } from '@nestjs/common';
import { CommunicationsService } from './communications.service';
import { AnnouncementSuggestionsService } from './announcement-suggestions.service';
import { CommunicationsController } from './communications.controller';
import { MailModule } from '../mail/mail.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [MailModule, NotificationsModule],
  providers: [CommunicationsService, AnnouncementSuggestionsService],
  controllers: [CommunicationsController],
  // ProjectsService raises "Announce this?" suggestions through it.
  exports: [AnnouncementSuggestionsService],
})
export class CommunicationsModule {}
