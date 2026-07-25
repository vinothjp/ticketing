import { Module } from '@nestjs/common';
import { TicketsService } from './tickets.service';
import {
  TicketsController,
  FieldCatalogController,
} from './tickets.controller';
import { TemplatesModule } from '../templates/templates.module';

@Module({
  imports: [TemplatesModule],
  providers: [TicketsService],
  controllers: [TicketsController, FieldCatalogController],
})
export class TicketsModule {}
