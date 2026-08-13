import { Module } from '@nestjs/common';
import { CustomerCompaniesService } from './customer-companies.service';
import { SupportHoursService } from './support-hours.service';
import { CustomerProductsService } from './customer-products.service';
import { AmcExpiryService } from './amc-expiry.service';
import { CustomerCompaniesController } from './customer-companies.controller';
import { MyCompanyController } from './my-company.controller';
import { MailModule } from '../mail/mail.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [MailModule, NotificationsModule],
  providers: [CustomerCompaniesService, SupportHoursService, CustomerProductsService, AmcExpiryService],
  controllers: [CustomerCompaniesController, MyCompanyController],
  exports: [CustomerCompaniesService, SupportHoursService],
})
export class CustomerCompaniesModule {}
