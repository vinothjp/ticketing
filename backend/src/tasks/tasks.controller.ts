import {
  Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, Request,
} from '@nestjs/common';
import { TasksService } from './tasks.service';
import { CreateTaskDto, UpdateTaskDto } from './dto/task.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { StaffGuard } from '../auth/staff.guard';

type AuthedRequest = { user: { id: string; clientId: string; roles: string[] } };

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('api/tickets/:ticketId/tasks')
export class TasksController {
  constructor(private tasksService: TasksService) {}

  @Get()
  list(@Param('ticketId') ticketId: string, @Request() req: AuthedRequest) {
    return this.tasksService.list(ticketId, req.user.clientId, req.user);
  }

  @Post()
  @UseGuards(StaffGuard)
  create(@Param('ticketId') ticketId: string, @Body() dto: CreateTaskDto, @Request() req: AuthedRequest) {
    return this.tasksService.create(ticketId, req.user.clientId, dto, req.user.id, req.user);
  }

  @Patch(':taskId')
  @UseGuards(StaffGuard)
  update(
    @Param('ticketId') ticketId: string,
    @Param('taskId') taskId: string,
    @Body() dto: UpdateTaskDto,
    @Request() req: AuthedRequest,
  ) {
    return this.tasksService.update(ticketId, taskId, req.user.clientId, dto, req.user.id, req.user);
  }

  @Delete(':taskId')
  @UseGuards(StaffGuard)
  remove(
    @Param('ticketId') ticketId: string,
    @Param('taskId') taskId: string,
    @Request() req: AuthedRequest,
  ) {
    return this.tasksService.remove(ticketId, taskId, req.user.clientId, req.user);
  }
}
