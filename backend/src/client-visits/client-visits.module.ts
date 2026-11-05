import { Module } from '@nestjs/common';
import { ClientVisitsService } from './client-visits.service';
import { ClientVisitsController } from './client-visits.controller';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  providers: [ClientVisitsService],
  controllers: [ClientVisitsController],
})
export class ClientVisitsModule {}
