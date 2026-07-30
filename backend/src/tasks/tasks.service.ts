import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TicketsService, TicketViewer } from '../tickets/tickets.service';
import { ActivityService } from '../activity/activity.service';
import { CreateTaskDto, UpdateTaskDto } from './dto/task.dto';

@Injectable()
export class TasksService {
  constructor(
    private prisma: PrismaService,
    private tickets: TicketsService,
    private activity: ActivityService,
  ) {}

  private async assigneeName(userId?: string | null) {
    if (!userId) return null;
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
    return u?.username ?? null;
  }

  async list(ticketId: string, clientId: string, viewer: TicketViewer) {
    await this.tickets.findOne(ticketId, clientId, viewer);
    return this.prisma.ticketTask.findMany({
      where: { ticketId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /**
   * Open tasks assigned to a user across all tickets in the tenant — including tasks
   * created by other agents on their own tickets. Non-admins only ever see their own;
   * admins may target another agent via `assigneeId`.
   */
  async myTasks(clientId: string, viewer: TicketViewer, assigneeId?: string) {
    const isAdmin = viewer.roles.includes('Admin');
    const assignee = assigneeId && isAdmin ? assigneeId : viewer.id;
    return this.prisma.ticketTask.findMany({
      where: {
        assigneeUserId: assignee,
        status: { not: 'DONE' },
        ticket: { clientId },
      },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
      include: {
        ticket: {
          select: { id: true, ticketNumber: true, subject: true, ticketStatus: true, priority: true },
        },
      },
    });
  }

  async create(ticketId: string, clientId: string, dto: CreateTaskDto, actorId: string, viewer: TicketViewer) {
    await this.tickets.findOne(ticketId, clientId, viewer);
    const last = await this.prisma.ticketTask.findFirst({
      where: { ticketId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    const task = await this.prisma.ticketTask.create({
      data: {
        ticketId,
        title: dto.title,
        description: dto.description,
        assigneeUserId: dto.assigneeUserId,
        assigneeName: await this.assigneeName(dto.assigneeUserId),
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        sortOrder: (last?.sortOrder ?? -1) + 1,
        createdBy: actorId,
      },
    });
    await this.activity.log({ ticketId, actorUserId: actorId, type: 'TASK_ADDED', summary: `Task added: ${dto.title}` });
    return task;
  }

  async update(ticketId: string, taskId: string, clientId: string, dto: UpdateTaskDto, actorId: string, viewer: TicketViewer) {
    await this.tickets.findOne(ticketId, clientId, viewer);
    const existing = await this.prisma.ticketTask.findFirst({ where: { id: taskId, ticketId } });
    if (!existing) throw new NotFoundException('Task not found');

    const becomingDone = dto.status === 'DONE' && existing.status !== 'DONE';
    const task = await this.prisma.ticketTask.update({
      where: { id: taskId },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.assigneeUserId !== undefined && {
          assigneeUserId: dto.assigneeUserId || null,
          assigneeName: await this.assigneeName(dto.assigneeUserId),
        }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.dueDate !== undefined && { dueDate: dto.dueDate ? new Date(dto.dueDate) : null }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
        ...(dto.status !== undefined && { completedAt: dto.status === 'DONE' ? new Date() : null }),
      },
    });
    if (becomingDone) {
      await this.activity.log({ ticketId, actorUserId: actorId, type: 'TASK_COMPLETED', summary: `Task completed: ${task.title}` });
    }
    return task;
  }

  async remove(ticketId: string, taskId: string, clientId: string, viewer: TicketViewer) {
    await this.tickets.findOne(ticketId, clientId, viewer);
    const existing = await this.prisma.ticketTask.findFirst({ where: { id: taskId, ticketId } });
    if (!existing) throw new NotFoundException('Task not found');
    await this.prisma.ticketTask.delete({ where: { id: taskId } });
    return { message: 'Task deleted' };
  }
}
