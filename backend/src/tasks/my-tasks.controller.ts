import { Controller, Get, Query, UseGuards, Request } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';

type AuthedRequest = { user: { id: string; clientId: string; roles: string[] } };

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('api/my-tasks')
export class MyTasksController {
  constructor(private tasksService: TasksService) {}

  /** Open tasks assigned to the current user across all tickets (admins may target `assignee`). */
  @Get()
  list(@Request() req: AuthedRequest, @Query('assignee') assignee?: string) {
    return this.tasksService.myTasks(req.user.clientId, req.user, assignee);
  }
}
