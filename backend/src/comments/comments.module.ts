import { Module } from '@nestjs/common';
import { CommentsService } from './comments.service';
import { CommentsController } from './comments.controller';
import { TicketsModule } from '../tickets/tickets.module';
import { ActivityModule } from '../activity/activity.module';

@Module({
  imports: [TicketsModule, ActivityModule],
  providers: [CommentsService],
  controllers: [CommentsController],
})
export class CommentsModule {}
