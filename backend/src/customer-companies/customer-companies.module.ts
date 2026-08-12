import { Module } from '@nestjs/common';
import { CustomerCompaniesService } from './customer-companies.service';
import { CustomerCompaniesController } from './customer-companies.controller';
import { MyCompanyController } from './my-company.controller';

@Module({
  providers: [CustomerCompaniesService],
  controllers: [CustomerCompaniesController, MyCompanyController],
  exports: [CustomerCompaniesService],
})
export class CustomerCompaniesModule {}
