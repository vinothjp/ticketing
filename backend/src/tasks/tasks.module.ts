import { Module } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { TasksController } from './tasks.controller';
import { TicketsModule } from '../tickets/tickets.module';
import { ActivityModule } from '../activity/activity.module';

@Module({
  imports: [TicketsModule, ActivityModule],
  providers: [TasksService],
  controllers: [TasksController],
})
export class TasksModule {}
