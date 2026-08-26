import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TicketsService, TicketViewer } from '../tickets/tickets.service';
import { ActivityService } from '../activity/activity.service';
import { CreateTaskDto, UpdateTaskDto } from './dto/task.dto';
import {
  RUNNING_TASK_STATUS,
  SETTLED_TASK_STATUSES,
  TASK_STATUS_LABELS,
} from './task-status';

/** Hours between two stamps, to two decimals. */
function hoursBetween(start: Date, end: Date): number {
  return Math.round(((end.getTime() - start.getTime()) / 3_600_000) * 100) / 100;
}

interface StatusEvent {
  toStatus: string;
  at: Date;
}

/**
 * Time the task stood in IN_PROGRESS, summed over its status trail.
 *
 * `openUntil` closes a stretch that is still running — pass `now` to show live
 * elapsed on a read, and leave it out when computing the figure to store, so the
 * stored number only ever counts finished stretches and never drifts.
 */
export function hoursFromEvents(events: StatusEvent[], openUntil?: Date): number {
  const ordered = [...events].sort((a, b) => a.at.getTime() - b.at.getTime());
  let total = 0;
  let startedAt: Date | null = null;
  for (const e of ordered) {
    if (e.toStatus === RUNNING_TASK_STATUS) {
      // Two events into IN_PROGRESS in a row can't happen — a change is only
      // recorded on a real transition — but keep the first stamp if they did.
      startedAt ??= e.at;
      continue;
    }
    if (startedAt) {
      total += hoursBetween(startedAt, e.at);
      startedAt = null;
    }
  }
  if (startedAt && openUntil) total += hoursBetween(startedAt, openUntil);
  return Math.round(total * 100) / 100;
}

/** The activity type a transition is logged under, so History keeps its icons. */
const ACTIVITY_TYPE: Record<string, string> = {
  DONE: 'TASK_COMPLETED',
  CANCELLED: 'TASK_CANCELLED',
  IN_PROGRESS: 'TASK_STARTED',
  OPEN: 'TASK_REOPENED',
};

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

  /**
   * A task's status belongs to the consultant doing the work: only the assignee
   * moves it, with a tenant Admin able to correct it. Other agents can see the
   * task but not rewrite someone else's timeline — the status trail is the
   * timesheet now, so the rule that guarded the old clock guards this instead.
   */
  private assertMayTrack(task: { assigneeUserId: string | null }, viewer: TicketViewer) {
    if (viewer.roles.includes('Admin')) return;
    if (task.assigneeUserId && task.assigneeUserId === viewer.id) return;
    throw new ForbiddenException(
      'Only the consultant this task is assigned to can change its status',
    );
  }

  /**
   * Hours to show for a task: the stored figure, plus the stretch still running
   * if the task is in progress right now.
   */
  private liveHours(task: { status: string; hoursSpent: unknown }, events: StatusEvent[]) {
    if (task.status !== RUNNING_TASK_STATUS) return Number(task.hoursSpent ?? 0);
    return hoursFromEvents(events, new Date());
  }

  async list(ticketId: string, clientId: string, viewer: TicketViewer) {
    await this.tickets.findOne(ticketId, clientId, viewer);
    const tasks = await this.prisma.ticketTask.findMany({
      where: { ticketId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        _count: { select: { comments: true } },
        // Only what the live-hours sum needs — the full trail is the dialog's job.
        statusEvents: { select: { toStatus: true, at: true }, orderBy: { at: 'asc' } },
      },
    });
    return tasks.map(({ statusEvents, _count, ...t }) => ({
      ...t,
      hoursSpent: this.liveHours(t, statusEvents),
      commentCount: _count.comments,
    }));
  }

  /** One task with its full status trail and comments — the task detail dialog. */
  async findOne(ticketId: string, taskId: string, clientId: string, viewer: TicketViewer) {
    await this.tickets.findOne(ticketId, clientId, viewer);
    const task = await this.prisma.ticketTask.findFirst({
      where: { id: taskId, ticketId },
      include: {
        statusEvents: { orderBy: { at: 'asc' } },
        comments: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!task) throw new NotFoundException('Task not found');
    return { ...task, hoursSpent: this.liveHours(task, task.statusEvents) };
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
        // A cancelled task is settled, so it leaves the queue the same way a
        // completed one does.
        status: { notIn: SETTLED_TASK_STATUSES },
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

    // Only a real transition counts. The status control emits on every pick,
    // including the option already selected, and re-recording that would stamp a
    // zero-length event and muddy the audit.
    const movingTo = dto.status && dto.status !== existing.status ? dto.status : null;
    if (movingTo) this.assertMayTrack(existing, viewer);
    // Done means the work is finished and booked. CANCELLED is deliberately
    // exempt — a task that turned out not to be needed is settled honestly with
    // no time against it.
    if (movingTo === 'DONE') {
      await this.assertTaskTimeLogged(ticketId, taskId, existing.title);
    }

    const hours = movingTo
      ? await this.recordStatusChange(existing, movingTo, actorId)
      : undefined;

    const task = await this.prisma.ticketTask.update({
      where: { id: taskId },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.assigneeUserId !== undefined && {
          assigneeUserId: dto.assigneeUserId || null,
          assigneeName: await this.assigneeName(dto.assigneeUserId),
        }),
        ...(dto.dueDate !== undefined && { dueDate: dto.dueDate ? new Date(dto.dueDate) : null }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
        ...(movingTo && {
          status: movingTo,
          completedAt: movingTo === 'DONE' ? new Date() : null,
          hoursSpent: hours || null,
        }),
      },
    });

    if (movingTo) {
      const label = (s: string) => TASK_STATUS_LABELS[s] ?? s;
      await this.activity.log({
        ticketId,
        actorUserId: actorId,
        type: ACTIVITY_TYPE[movingTo] ?? 'TASK_STATUS_CHANGED',
        summary: `Task "${task.title}": ${label(existing.status)} → ${label(movingTo)}`,
        meta: { taskId, from: existing.status, to: movingTo },
      });
    }
    return task;
  }

  /**
   * A task is only done once the work on it has been booked. `TicketWorklog` is
   * the billable record — the task's own `hoursSpent` is derived from the status
   * trail and charges nothing — so a task ticked done against an empty timesheet
   * silently under-bills the contract, the same hole `assertTimeLogged` closes at
   * the ticket level.
   */
  private async assertTaskTimeLogged(
    ticketId: string,
    taskId: string,
    title: string,
  ) {
    const totals = await this.prisma.ticketWorklog.aggregate({
      where: { ticketId, taskId },
      _sum: { hours: true },
    });
    if (!(Number(totals._sum.hours ?? 0) > 0)) {
      throw new BadRequestException(
        `Log the time spent on "${title}" before marking it done`,
      );
    }
  }

  /**
   * Stamp one status change and re-derive the task's hours from the whole trail.
   *
   * The stamp is taken **here**, server-side, rather than sent by the client —
   * the record is of when the status actually moved, not of what a browser
   * claimed. Re-deriving from the full trail rather than adding to a counter
   * means a corrected event fixes itself, the same way ticket worklog hours are
   * an on-read aggregate rather than a stored total.
   */
  private async recordStatusChange(
    existing: { id: string; ticketId: string; status: string },
    toStatus: string,
    actorId: string,
  ): Promise<number> {
    await this.prisma.ticketTaskStatusEvent.create({
      data: {
        taskId: existing.id,
        ticketId: existing.ticketId,
        fromStatus: existing.status,
        toStatus,
        actorUserId: actorId,
        // Denormalised, like TicketMessage.authorName — the trail then renders
        // without a join, and keeps naming whoever acted even if they leave.
        actorName: await this.assigneeName(actorId),
        at: new Date(),
      },
    });
    const events = await this.prisma.ticketTaskStatusEvent.findMany({
      where: { taskId: existing.id },
      select: { toStatus: true, at: true },
      orderBy: { at: 'asc' },
    });
    return hoursFromEvents(events);
  }

  async remove(ticketId: string, taskId: string, clientId: string, viewer: TicketViewer) {
    await this.tickets.findOne(ticketId, clientId, viewer);
    const existing = await this.prisma.ticketTask.findFirst({ where: { id: taskId, ticketId } });
    if (!existing) throw new NotFoundException('Task not found');
    // The hours logged against the task go with it, credited back to the
    // customer's support-hours pool. Must run *before* the delete: the worklog
    // link is `SetNull`, so once the task is gone there is nothing left to find
    // them by. The task's own `hoursSpent` is audit only and charges nothing, so
    // there is no second reversal to make — its status events and comments go by
    // cascade.
    const removed = await this.tickets.dropWorklogsForTask(ticketId, taskId, clientId, viewer);
    await this.prisma.ticketTask.delete({ where: { id: taskId } });
    return { message: 'Task deleted', worklogsRemoved: removed.count, hoursRemoved: removed.hours };
  }
}
