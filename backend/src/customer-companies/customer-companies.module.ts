import { Module } from '@nestjs/common';
import { CustomerCompaniesService } from './customer-companies.service';
import { CustomerCompaniesController } from './customer-companies.controller';

@Module({
  providers: [CustomerCompaniesService],
  controllers: [CustomerCompaniesController],
  exports: [CustomerCompaniesService],
})
export class CustomerCompaniesModule {}
