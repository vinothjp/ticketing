import { Module } from '@nestjs/common';
import { NotificationRulesController } from './notification-rules.controller';
import { NotificationRulesService } from './notification-rules.service';

@Module({
  controllers: [NotificationRulesController],
  providers: [NotificationRulesService],
  exports: [NotificationRulesService],
})
export class NotificationRulesModule {}
