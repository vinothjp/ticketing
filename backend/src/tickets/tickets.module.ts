import { Module } from '@nestjs/common';
import { TicketsService } from './tickets.service';
import {
  TicketsController,
  FieldCatalogController,
} from './tickets.controller';
import { TemplatesModule } from '../templates/templates.module';
import { ActivityModule } from '../activity/activity.module';

@Module({
  imports: [TemplatesModule, ActivityModule],
  providers: [TicketsService],
  controllers: [TicketsController, FieldCatalogController],
  exports: [TicketsService],
})
export class TicketsModule {}
