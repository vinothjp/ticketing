import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, Request,
} from '@nestjs/common';
import { ProjectsService } from './projects.service';
import {
  CreateProjectDto, UpdateProjectDto,
  CreateProjectTaskDto, UpdateProjectTaskDto, UpdateTaskStatusDto,
  CreateMilestoneDto, UpdateMilestoneDto,
  CreateTaskCommentDto, AddWatcherDto, AddDependencyDto,
  CreateSprintDto, UpdateSprintDto,
  CreateResourceDto, UpdateResourceDto, CreateTimesheetDto, UpdateTimesheetDto,
  DecideChangeRequestDto,
} from './dto/project.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

type AuthedRequest = { user: { id: string; clientId: string; roles: string[]; username?: string } };

// Internal agents & admins only (no Customer role on any route).
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('Admin', 'Viewer')
@Controller('api/projects')
export class ProjectsController {
  constructor(private projects: ProjectsService) {}

  // ---- Projects ----
  @Get()
  list(
    @Request() req: AuthedRequest,
    @Query('search') search?: string,
    @Query('status') status?: string,
  ) {
    return this.projects.list(req.user.clientId, { search, status });
  }

  // Declared before ':id' so "analytics" isn't captured as a project id.
  @Get('analytics')
  analytics(@Request() req: AuthedRequest) {
    return this.projects.analytics(req.user.clientId);
  }

  @Get(':id/financials')
  financials(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.projects.financials(id, req.user.clientId);
  }

  // Customer-company people eligible to be invited to this project's meetings.
  @Get(':id/customer-contacts')
  customerContacts(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.projects.customerContacts(id, req.user.clientId);
  }

  // ---- Change requests (budget change control) ----
  @Get(':id/change-requests')
  changeRequests(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.projects.changeRequests(id, req.user.clientId);
  }

  @Patch('change-requests/:crId/decision')
  decideChangeRequest(@Param('crId') crId: string, @Body() dto: DecideChangeRequestDto, @Request() req: AuthedRequest) {
    return this.projects.decideChangeRequest(crId, dto.status, req.user.clientId, req.user);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.projects.findOne(id, req.user.clientId);
  }

  @Post()
  create(@Body() dto: CreateProjectDto, @Request() req: AuthedRequest) {
    return this.projects.create(dto, req.user.clientId, req.user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProjectDto, @Request() req: AuthedRequest) {
    return this.projects.update(id, dto, req.user.clientId, req.user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.projects.remove(id, req.user.clientId);
  }


  // ---- Tasks ----
  @Get(':id/tasks')
  listTasks(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.projects.listTasks(id, req.user.clientId);
  }

  @Post(':id/tasks')
  createTask(@Param('id') id: string, @Body() dto: CreateProjectTaskDto, @Request() req: AuthedRequest) {
    return this.projects.createTask(id, dto, req.user.clientId, req.user);
  }

  @Patch('tasks/:taskId')
  updateTask(@Param('taskId') taskId: string, @Body() dto: UpdateProjectTaskDto, @Request() req: AuthedRequest) {
    return this.projects.updateTask(taskId, dto, req.user.clientId, req.user);
  }

  @Patch('tasks/:taskId/status')
  updateTaskStatus(@Param('taskId') taskId: string, @Body() dto: UpdateTaskStatusDto, @Request() req: AuthedRequest) {
    return this.projects.updateTaskStatus(taskId, dto, req.user.clientId, req.user);
  }

  @Patch('tasks/:taskId/move')
  moveTask(@Param('taskId') taskId: string, @Body() body: { direction: 'up' | 'down' }, @Request() req: AuthedRequest) {
    return this.projects.moveTask(taskId, body.direction, req.user.clientId, req.user);
  }

  @Delete('tasks/:taskId')
  removeTask(@Param('taskId') taskId: string, @Request() req: AuthedRequest) {
    return this.projects.removeTask(taskId, req.user.clientId, req.user);
  }

  // ---- Task detail (comments, watchers, dependencies) ----
  @Get('tasks/:taskId/detail')
  taskDetail(@Param('taskId') taskId: string, @Request() req: AuthedRequest) {
    return this.projects.taskDetail(taskId, req.user.clientId);
  }

  @Post('tasks/:taskId/comments')
  addComment(@Param('taskId') taskId: string, @Body() dto: CreateTaskCommentDto, @Request() req: AuthedRequest) {
    return this.projects.addComment(taskId, dto, req.user.clientId, req.user);
  }

  @Delete('task-comments/:commentId')
  removeComment(@Param('commentId') commentId: string, @Request() req: AuthedRequest) {
    return this.projects.removeComment(commentId, req.user.clientId);
  }

  @Post('tasks/:taskId/watchers')
  addWatcher(@Param('taskId') taskId: string, @Body() dto: AddWatcherDto, @Request() req: AuthedRequest) {
    return this.projects.addWatcher(taskId, dto, req.user.clientId);
  }

  @Delete('tasks/:taskId/watchers/:userId')
  removeWatcher(@Param('taskId') taskId: string, @Param('userId') userId: string, @Request() req: AuthedRequest) {
    return this.projects.removeWatcher(taskId, userId, req.user.clientId);
  }

  @Post('tasks/:taskId/dependencies')
  addDependency(@Param('taskId') taskId: string, @Body() dto: AddDependencyDto, @Request() req: AuthedRequest) {
    return this.projects.addDependency(taskId, dto, req.user.clientId);
  }

  @Delete('dependencies/:depId')
  removeDependency(@Param('depId') depId: string, @Request() req: AuthedRequest) {
    return this.projects.removeDependency(depId, req.user.clientId);
  }

  // ---- Sprints ----
  @Get(':id/sprints')
  listSprints(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.projects.listSprints(id, req.user.clientId);
  }

  @Post(':id/sprints')
  createSprint(@Param('id') id: string, @Body() dto: CreateSprintDto, @Request() req: AuthedRequest) {
    return this.projects.createSprint(id, dto, req.user.clientId, req.user);
  }

  @Patch('sprints/:sprintId')
  updateSprint(@Param('sprintId') sprintId: string, @Body() dto: UpdateSprintDto, @Request() req: AuthedRequest) {
    return this.projects.updateSprint(sprintId, dto, req.user.clientId);
  }

  @Post('sprints/:sprintId/start')
  startSprint(@Param('sprintId') sprintId: string, @Request() req: AuthedRequest) {
    return this.projects.setSprintStatus(sprintId, 'ACTIVE', req.user.clientId);
  }

  @Post('sprints/:sprintId/complete')
  completeSprint(@Param('sprintId') sprintId: string, @Request() req: AuthedRequest) {
    return this.projects.setSprintStatus(sprintId, 'COMPLETED', req.user.clientId);
  }

  @Delete('sprints/:sprintId')
  removeSprint(@Param('sprintId') sprintId: string, @Request() req: AuthedRequest) {
    return this.projects.removeSprint(sprintId, req.user.clientId);
  }

  // ---- Milestones (grouping / stage gates) ----
  @Get(':id/milestones')
  listMilestones(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.projects.listMilestones(id, req.user.clientId);
  }

  @Post(':id/milestones')
  createMilestone(@Param('id') id: string, @Body() dto: CreateMilestoneDto, @Request() req: AuthedRequest) {
    return this.projects.createMilestone(id, dto, req.user.clientId, req.user);
  }

  @Patch('milestones/:milestoneId')
  updateMilestone(@Param('milestoneId') milestoneId: string, @Body() dto: UpdateMilestoneDto, @Request() req: AuthedRequest) {
    return this.projects.updateMilestone(milestoneId, dto, req.user.clientId);
  }

  @Delete('milestones/:milestoneId')
  removeMilestone(@Param('milestoneId') milestoneId: string, @Request() req: AuthedRequest) {
    return this.projects.removeMilestone(milestoneId, req.user.clientId);
  }

  // ---- Resources plan ----
  @Post(':id/resources')
  addResource(@Param('id') id: string, @Body() dto: CreateResourceDto, @Request() req: AuthedRequest) {
    return this.projects.addResource(id, dto, req.user.clientId, req.user);
  }

  @Patch('resources/:resourceId')
  updateResource(@Param('resourceId') resourceId: string, @Body() dto: UpdateResourceDto, @Request() req: AuthedRequest) {
    return this.projects.updateResource(resourceId, dto, req.user.clientId);
  }

  @Delete('resources/:resourceId')
  removeResource(@Param('resourceId') resourceId: string, @Request() req: AuthedRequest) {
    return this.projects.removeResource(resourceId, req.user.clientId);
  }

  // ---- Timesheets ----
  @Post(':id/timesheets')
  addTimesheet(@Param('id') id: string, @Body() dto: CreateTimesheetDto, @Request() req: AuthedRequest) {
    return this.projects.addTimesheet(id, dto, req.user.clientId, req.user);
  }

  @Patch('timesheets/:timesheetId')
  updateTimesheet(@Param('timesheetId') timesheetId: string, @Body() dto: UpdateTimesheetDto, @Request() req: AuthedRequest) {
    return this.projects.updateTimesheet(timesheetId, dto, req.user.clientId);
  }

  @Delete('timesheets/:timesheetId')
  removeTimesheet(@Param('timesheetId') timesheetId: string, @Request() req: AuthedRequest) {
    return this.projects.removeTimesheet(timesheetId, req.user.clientId);
  }

  // ---- Ticket linking ----
  @Post(':id/tickets/:ticketId')
  linkTicket(@Param('id') id: string, @Param('ticketId') ticketId: string, @Request() req: AuthedRequest) {
    return this.projects.linkTicket(id, ticketId, req.user.clientId);
  }

  @Delete(':id/tickets/:ticketId')
  unlinkTicket(@Param('id') id: string, @Param('ticketId') ticketId: string, @Request() req: AuthedRequest) {
    return this.projects.unlinkTicket(id, ticketId, req.user.clientId);
  }
}
