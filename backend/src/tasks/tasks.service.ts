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
  COMPLETED_TASK_STATUS,
  RUNNING_TASK_STATUS,
  SETTLED_TASK_STATUSES,
  TASK_STATUS_LABELS,
} from './task-status';

/**
 * Hours between two stamps, to four decimals. Fine enough that a short stretch —
 * a task started and stopped seconds apart while testing, say — still books a
 * real, non-zero figure instead of rounding away to nothing. Only a sub-second
 * stretch (< 0.36s) rounds to zero.
 */
function hoursBetween(start: Date, end: Date): number {
  return round4((end.getTime() - start.getTime()) / 3_600_000);
}

/** Hours, at the four decimals every figure in this module is kept to. */
function round4(hours: number): number {
  return Math.round(hours * 10000) / 10000;
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
  return Math.round(total * 10000) / 10000;
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
   * Pulling a completed task back open is a *wider* right than running it, and a
   * deliberately different one: the task's own assignee is the person who called
   * it finished, so letting them quietly undo that would make "completed" mean
   * nothing. It belongs to whoever owns the ticket — its assigned agent — or to
   * a tenant Admin, and it is checked here in place of `assertMayTrack`, never
   * alongside it.
   *
   * A ticket holds at most one agent, but the assignment still lives in the
   * `TicketTechnician` join table, so this reads the join rather than a column.
   */
  private async assertMayReopen(ticketId: string, viewer: TicketViewer) {
    if (viewer.roles.includes('Admin')) return;
    const holds = await this.prisma.ticketTechnician.findFirst({
      where: { ticketId, userId: viewer.id },
      select: { id: true },
    });
    if (holds) return;
    throw new ForbiddenException(
      'Only the agent this ticket is assigned to, or an admin, can reopen a completed task',
    );
  }

  /**
   * What a task has actually booked, per task id.
   *
   * `TicketWorklog` — not the derived status trail — is the figure every other
   * surface quotes: the ticket header's Time spent, the task dialog's own total
   * and the customer's support-hours pool are all sums of these rows. Reading the
   * grid off the same table is what keeps those numbers equal by construction —
   * the stored `hoursSpent` (time the task stood in progress) is audit only and
   * would otherwise quote hours the contract was never charged.
   */
  private async bookedHours(ticketId: string): Promise<Map<string, number>> {
    const rows = await this.prisma.ticketWorklog.groupBy({
      by: ['taskId'],
      where: { ticketId, taskId: { not: null } },
      _sum: { hours: true },
    });
    return new Map(
      rows.map((r) => [String(r.taskId), Number(r._sum.hours ?? 0)]),
    );
  }

  async list(ticketId: string, clientId: string, viewer: TicketViewer) {
    await this.tickets.findOne(ticketId, clientId, viewer);
    const [tasks, booked] = await Promise.all([
      this.prisma.ticketTask.findMany({
        where: { ticketId },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        include: { _count: { select: { comments: true } } },
      }),
      this.bookedHours(ticketId),
    ]);
    return tasks.map(({ _count, ...t }) => ({
      ...t,
      hoursSpent: round4(booked.get(t.id) ?? 0),
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
    const booked = await this.bookedHours(ticketId);
    return { ...task, hoursSpent: round4(booked.get(task.id) ?? 0) };
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
    // Both counters are max+1 rather than a count, so deleting a task never hands
    // its number to the next one — the grid's Task ID has to keep meaning the same
    // task in a comment or a conversation about it.
    const last = await this.prisma.ticketTask.aggregate({
      where: { ticketId },
      _max: { sortOrder: true, taskNumber: true },
    });
    const task = await this.prisma.ticketTask.create({
      data: {
        ticketId,
        taskNumber: (last._max.taskNumber ?? 0) + 1,
        title: dto.title,
        description: dto.description,
        assigneeUserId: dto.assigneeUserId,
        assigneeName: await this.assigneeName(dto.assigneeUserId),
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        estimatedHours: dto.estimatedHours ?? null,
        sortOrder: (last._max.sortOrder ?? -1) + 1,
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

    // Leaving COMPLETED is a reopen, and answers to its own rule: the ticket's
    // agent or an admin, never the task assignee who closed it, and never
    // without saying why. Every other move stays with the consultant doing the
    // work. Both doors — the timer's Reopen button and the status dropdown —
    // come through here, so neither can slip past the note.
    const reopening = !!movingTo && existing.status === COMPLETED_TASK_STATUS;
    const reopenNote = dto.reopenNote?.trim() ?? '';
    if (reopening) {
      await this.assertMayReopen(ticketId, viewer);
      if (!reopenNote) {
        throw new BadRequestException('Say why this task is being reopened');
      }
    } else if (movingTo) {
      this.assertMayTrack(existing, viewer);
    }

    // Work in progress is somebody's work. A task may be *raised* unassigned —
    // often it is, before anyone has picked it up — but it cannot be started
    // that way, or the status trail records a stretch with no one on it and
    // `assertMayTrack` has nobody to answer to afterwards. The assignee may
    // arrive in this very PATCH (that is what the edit screen's prompt sends),
    // so read the incoming value first and fall back to the stored one.
    if (movingTo === RUNNING_TASK_STATUS) {
      const assignee = dto.assigneeUserId !== undefined
        ? dto.assigneeUserId || null
        : existing.assigneeUserId;
      if (!assignee) {
        throw new BadRequestException(
          `Assign "${existing.title}" to someone before starting it`,
        );
      }
    }

    // The hours typed on the edit screen's completion prompt, booked as a worklog —
    // that entry, not the status trail, is what charges the customer's
    // support-hours pool. It runs *before* the DONE gate below, so the time just
    // entered is what satisfies it, and before the status is written, so an
    // exhausted pool refuses the whole move rather than settling the task with
    // nothing behind it.
    const logHours = Number(dto.logHours ?? 0);
    if (logHours > 0) {
      await this.tickets.addWorklog(
        ticketId,
        { hours: logHours, taskId },
        clientId,
        actorId,
        viewer,
      );
    }

    // Done means the work is finished and booked. CANCELLED is deliberately
    // exempt — a task that turned out not to be needed is settled honestly with
    // no time against it.
    if (movingTo === 'DONE') {
      await this.assertTaskTimeLogged(ticketId, taskId, existing.title);
    }

    const hours = movingTo
      ? await this.recordStatusChange(existing, movingTo, actorId, reopening ? reopenNote : null)
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
        summary: `Task "${task.title}": ${label(existing.status)} → ${label(movingTo)}`
          + (reopening ? ` — reopened: ${reopenNote}` : ''),
        meta: { taskId, from: existing.status, to: movingTo, ...(reopening && { reopenNote }) },
      });
    }
    return task;
  }

  /**
   * A task is only done once the work on it has been booked. `TicketWorklog` is
   * the billable record, written by the log-time prompt the edit screen raises on
   * a status change — so a task ticked done against an empty timesheet is one
   * nobody entered time for, and settling it would silently under-bill the
   * contract, the same hole `assertTimeLogged` closes at the ticket level.
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
    note: string | null = null,
  ): Promise<number> {
    await this.prisma.ticketTaskStatusEvent.create({
      data: {
        taskId: existing.id,
        ticketId: existing.ticketId,
        fromStatus: existing.status,
        toStatus,
        note,
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
