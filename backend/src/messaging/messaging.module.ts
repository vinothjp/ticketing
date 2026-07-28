import { Module } from '@nestjs/common';
import { ChannelService } from './channel.service';
import { ChannelConfigService } from './channel-config.service';
import { ImapPollerService } from './imap-poller.service';
import { MessagesController } from './messages.controller';
import { ChannelsController } from './channels.controller';
import { WebhooksController } from './webhooks.controller';
import { TicketsModule } from '../tickets/tickets.module';
import { ActivityModule } from '../activity/activity.module';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [TicketsModule, ActivityModule, MailModule],
  providers: [ChannelService, ChannelConfigService, ImapPollerService],
  controllers: [MessagesController, ChannelsController, WebhooksController],
})
export class MessagingModule {}
