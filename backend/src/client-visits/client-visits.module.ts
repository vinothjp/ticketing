import { Module } from '@nestjs/common';
import { ClientVisitsService } from './client-visits.service';
import { ClientVisitsController } from './client-visits.controller';

@Module({
  providers: [ClientVisitsService],
  controllers: [ClientVisitsController],
})
export class ClientVisitsModule {}
