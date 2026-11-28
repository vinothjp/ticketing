import { Module } from '@nestjs/common';
import { TicketsService } from './tickets.service';
import { TicketAutoCloseService } from './ticket-auto-close.service';
import { TicketSlaEscalationService } from './ticket-sla-escalation.service';
import {
  TicketsController,
  FieldCatalogController,
} from './tickets.controller';
import { TemplatesModule } from '../templates/templates.module';
import { ActivityModule } from '../activity/activity.module';
import { MailModule } from '../mail/mail.module';
import { ProductsModule } from '../products/products.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CustomerCompaniesModule } from '../customer-companies/customer-companies.module';
import { NotificationRulesModule } from '../notification-rules/notification-rules.module';

@Module({
  imports: [TemplatesModule, ActivityModule, MailModule, ProductsModule, NotificationsModule, CustomerCompaniesModule, NotificationRulesModule],
  providers: [TicketsService, TicketAutoCloseService, TicketSlaEscalationService],
  controllers: [TicketsController, FieldCatalogController],
  exports: [TicketsService],
})
export class TicketsModule {}
