import { Module } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { TasksController } from './tasks.controller';
import { MyTasksController } from './my-tasks.controller';
import { TicketsModule } from '../tickets/tickets.module';
import { ActivityModule } from '../activity/activity.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [TicketsModule, ActivityModule, NotificationsModule],
  providers: [TasksService],
  controllers: [TasksController, MyTasksController],
})
export class TasksModule {}
