import { ForbiddenException } from '@nestjs/common';
import { TasksService, hoursFromEvents } from './tasks.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { TicketsService, TicketViewer } from '../tickets/tickets.service';
import type { ActivityService } from '../activity/activity.service';
import type { NotificationsService } from '../notifications/notifications.service';

const CLIENT_ID = 'tenant-1';
const TICKET_ID = 'ticket-1';

type TaskRow = Record<string, unknown>;
type EventRow = { toStatus: string; at: Date };

function taskRow(overrides: TaskRow = {}): TaskRow {
  return {
    id: 'task-1',
    ticketId: TICKET_ID,
    title: 'Patch the interface',
    status: 'OPEN',
    assigneeUserId: 'agent-1',
    assigneeName: 'agent1',
    hoursSpent: null,
    ...overrides,
  };
}

/**
 * `events` is the trail the task already has; anything `recordStatusChange`
 * writes is appended, so the hours the service derives are the hours it would
 * derive from a real table.
 */
function build(task: TaskRow, events: EventRow[] = [], worklogHours: number | null = 1) {
  const trail = [...events];
  const prisma = {
    ticketTask: {
      findFirst: jest.fn().mockResolvedValue(task),
      findMany: jest.fn().mockResolvedValue([task]),
      aggregate: jest.fn().mockResolvedValue({ _max: { sortOrder: 2, taskNumber: 2 } }),
      create: jest.fn().mockImplementation(({ data }: { data: TaskRow }) => ({ id: 'task-2', ...data })),
      update: jest.fn().mockImplementation(({ data }: { data: TaskRow }) => ({ ...task, ...data })),
      delete: jest.fn().mockResolvedValue(task),
    },
    ticketTaskStatusEvent: {
      create: jest.fn().mockImplementation(({ data }: { data: { toStatus: string; at: Date } }) => {
        trail.push({ toStatus: data.toStatus, at: data.at });
        return data;
      }),
      findMany: jest.fn().mockImplementation(() => Promise.resolve(trail)),
      findFirst: jest.fn().mockImplementation(() => Promise.resolve(trail[trail.length - 1] ?? null)),
    },
    // The task's own `hoursSpent` is derived from the trail and audit only; the
    // billable figure — what the DONE gate checks and what every screen quotes —
    // is the worklog total. `worklogHours` lets a test say time has already been
    // entered against the task.
    ticketWorklog: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { hours: worklogHours } }),
      groupBy: jest.fn().mockResolvedValue([
        { taskId: 'task-1', _sum: { hours: worklogHours } },
      ]),
    },
    ticket: { findUniqueOrThrow: jest.fn().mockResolvedValue({ clientId: CLIENT_ID }) },
    // Who holds the ticket, which is what decides whether a viewer reads the
    // whole task board or only their own rows. Defaults to "the viewer does",
    // so a test about anything else sees every task.
    ticketTechnician: { findFirst: jest.fn().mockResolvedValue({ id: 'tt-1' }) },
    user: { findUnique: jest.fn().mockResolvedValue({ username: 'agent1' }) },
  };
  const tickets = {
    findOne: jest.fn().mockResolvedValue({ id: TICKET_ID, clientId: CLIENT_ID }),
    // The hours typed on the edit screen's status prompt are booked through here.
    addWorklog: jest.fn().mockResolvedValue({ id: 'wl-1' }),
  };
  const activity = { log: jest.fn().mockResolvedValue(undefined) };
  const notifications = { notify: jest.fn().mockResolvedValue(undefined) };

  const service = new TasksService(
    prisma as unknown as PrismaService,
    tickets as unknown as TicketsService,
    activity as unknown as ActivityService,
    notifications as unknown as NotificationsService,
  );
  return { service, prisma, tickets, activity, notifications, trail };
}

const assignee: TicketViewer = { id: 'agent-1', roles: ['Viewer'] };
const otherAgent: TicketViewer = { id: 'agent-9', roles: ['Viewer'] };
const admin: TicketViewer = { id: 'admin-1', roles: ['Admin'] };

const hoursAgo = (n: number) => new Date(Date.now() - n * 3_600_000);
const move = (
  service: TasksService,
  status: string,
  viewer: TicketViewer = assignee,
  extra: Record<string, unknown> = {},
) => service.update(TICKET_ID, 'task-1', CLIENT_ID, { status, ...extra }, viewer.id, viewer);

describe('hoursFromEvents', () => {
  it('sums every stretch the task stood in progress', () => {
    const hours = hoursFromEvents([
      { toStatus: 'IN_PROGRESS', at: hoursAgo(6) },
      { toStatus: 'OPEN', at: hoursAgo(5) },
      { toStatus: 'IN_PROGRESS', at: hoursAgo(3) },
      { toStatus: 'DONE', at: hoursAgo(1) },
    ]);
    expect(hours).toBe(3);
  });

  it('ignores time outside in-progress, and an open stretch unless asked', () => {
    const trail = [
      { toStatus: 'IN_PROGRESS', at: hoursAgo(2) },
    ];
    expect(hoursFromEvents(trail)).toBe(0);
    expect(hoursFromEvents(trail, new Date())).toBe(2);
  });

  it('reads a trail handed over out of order', () => {
    const hours = hoursFromEvents([
      { toStatus: 'DONE', at: hoursAgo(1) },
      { toStatus: 'IN_PROGRESS', at: hoursAgo(3) },
    ]);
    expect(hours).toBe(2);
  });
});

describe('TasksService — status changes drive the clock', () => {
  it('stamps the transition server-side and logs it', async () => {
    const { service, prisma, activity } = build(taskRow());

    await move(service, 'IN_PROGRESS');

    const { data } = prisma.ticketTaskStatusEvent.create.mock.calls[0][0];
    expect(data).toMatchObject({ taskId: 'task-1', fromStatus: 'OPEN', toStatus: 'IN_PROGRESS' });
    expect(data.at).toBeInstanceOf(Date);
    expect(prisma.ticketTask.update.mock.calls[0][0].data.status).toBe('IN_PROGRESS');
    expect(activity.log).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'TASK_STARTED', meta: expect.objectContaining({ from: 'OPEN', to: 'IN_PROGRESS' }) }),
    );
  });

  it('books the hours the task spent in progress when it finishes', async () => {
    const { service, prisma } = build(
      taskRow({ status: 'IN_PROGRESS' }),
      [{ toStatus: 'IN_PROGRESS', at: hoursAgo(2) }],
    );

    await move(service, 'DONE');

    const { data } = prisma.ticketTask.update.mock.calls[0][0];
    expect(data.status).toBe('DONE');
    expect(data.hoursSpent).toBe(2);
    expect(data.completedAt).toBeInstanceOf(Date);
  });

  it('adds a second stretch to the first rather than replacing it', async () => {
    const { service, prisma } = build(
      taskRow({ status: 'IN_PROGRESS', hoursSpent: 1 }),
      [
        { toStatus: 'IN_PROGRESS', at: hoursAgo(6) },
        { toStatus: 'OPEN', at: hoursAgo(5) },
        { toStatus: 'IN_PROGRESS', at: hoursAgo(2) },
      ],
    );

    await move(service, 'DONE');

    expect(prisma.ticketTask.update.mock.calls[0][0].data.hoursSpent).toBe(3);
  });

  it('books the hours entered with the status change as a worklog', async () => {
    // The log-time prompt on the edit screen is what charges the pool: whatever
    // the consultant confirms there is booked through `addWorklog`, tagged with
    // the task it was spent on.
    const { service, tickets } = build(taskRow({ status: 'IN_PROGRESS' }));

    await move(service, 'DONE', assignee, { logHours: 2.5 });

    expect(tickets.addWorklog).toHaveBeenCalledTimes(1);
    const [ticketId, dto] = tickets.addWorklog.mock.calls[0];
    expect(ticketId).toBe(TICKET_ID);
    expect(dto.taskId).toBe('task-1');
    expect(dto.hours).toBe(2.5);
  });

  it('books nothing when no time is entered', async () => {
    // A move that logs nothing charges nothing — renaming a task or picking up an
    // open one must not touch the customer's hours.
    const { service, tickets } = build(taskRow({ status: 'OPEN' }));

    await move(service, 'IN_PROGRESS');

    expect(tickets.addWorklog).not.toHaveBeenCalled();
  });

  it('books the entered hours before the done gate reads them', async () => {
    // The gate asks the worklog table, so the booking has to happen first or a
    // task whose only time is the figure just typed would be refused.
    const { service, tickets } = build(taskRow({ status: 'IN_PROGRESS' }), [], 0);
    const order: string[] = [];
    tickets.addWorklog.mockImplementation(async () => { order.push('book'); return { id: 'wl-1' }; });
    (service as unknown as { prisma: { ticketWorklog: { aggregate: jest.Mock } } })
      .prisma.ticketWorklog.aggregate.mockImplementation(async () => {
        order.push('gate');
        return { _sum: { hours: 1 } };
      });

    await move(service, 'DONE', assignee, { logHours: 1 });

    expect(order).toEqual(['book', 'gate']);
  });

  it('refuses to start a task nobody is assigned to', async () => {
    // A task may be raised unassigned, but not started that way: the trail is a
    // timesheet, and a stretch in progress has to belong to someone.
    const { service } = build(taskRow({ assigneeUserId: null, assigneeName: null }));

    await expect(move(service, 'IN_PROGRESS', admin)).rejects.toThrow(/assign/i);
  });

  it('starts it when the assignee arrives with the same move', async () => {
    // What the edit screen's prompt sends: the person taking the task and the
    // move to In progress, in one PATCH — so the incoming value has to be read
    // before the stored one.
    const { service, prisma } = build(taskRow({ assigneeUserId: null, assigneeName: null }));

    await move(service, 'IN_PROGRESS', admin, { assigneeUserId: 'agent-1' });

    const { data } = prisma.ticketTask.update.mock.calls[0][0];
    expect(data.status).toBe('IN_PROGRESS');
    expect(data.assigneeUserId).toBe('agent-1');
  });

  it('does not demand an assignee to pause, cancel or complete a task', async () => {
    // The rule is about work *in progress*, not about the task itself — settling
    // an orphaned task must not be blocked by it.
    const { service } = build(taskRow({ assigneeUserId: null, assigneeName: null }));

    await expect(move(service, 'CANCELLED', admin)).resolves.toBeDefined();
  });

  it('blocks marking a task done when no time was ever logged against it', async () => {
    // A task nobody entered time for has no worklog behind it, so the DONE gate
    // refuses it — settling it would under-bill the contract.
    const { service } = build(taskRow({ status: 'OPEN' }), [], 0);

    await expect(move(service, 'DONE')).rejects.toThrow(/log the time/i);
  });

  it('settles a cancelled task on the time it had actually spent', async () => {
    const { service, prisma, activity } = build(
      taskRow({ status: 'IN_PROGRESS' }),
      [{ toStatus: 'IN_PROGRESS', at: hoursAgo(1) }],
    );

    await move(service, 'CANCELLED');

    const { data } = prisma.ticketTask.update.mock.calls[0][0];
    expect(data.status).toBe('CANCELLED');
    expect(data.hoursSpent).toBe(1);
    expect(data.completedAt).toBeNull();
    expect(activity.log).toHaveBeenCalledWith(expect.objectContaining({ type: 'TASK_CANCELLED' }));
  });

  it('ignores a re-pick of the status the task already has', async () => {
    const { service, prisma, activity } = build(taskRow({ status: 'IN_PROGRESS' }));

    await move(service, 'IN_PROGRESS');

    expect(prisma.ticketTaskStatusEvent.create).not.toHaveBeenCalled();
    expect(activity.log).not.toHaveBeenCalled();
    expect(prisma.ticketTask.update.mock.calls[0][0].data.status).toBeUndefined();
  });

  it('lets another agent edit the title but not move the status', async () => {
    const { service, prisma } = build(taskRow());

    await service.update(TICKET_ID, 'task-1', CLIENT_ID, { title: 'Renamed' }, otherAgent.id, otherAgent);
    expect(prisma.ticketTask.update.mock.calls[0][0].data.title).toBe('Renamed');

    await expect(move(service, 'DONE', otherAgent)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("lets a tenant admin correct someone else's task", async () => {
    const { service, prisma } = build(taskRow({ status: 'IN_PROGRESS' }));

    await move(service, 'DONE', admin);

    expect(prisma.ticketTask.update).toHaveBeenCalled();
  });
});

describe('TasksService — reading tasks', () => {
  it('quotes the booked hours, not the stored trail figure', async () => {
    // The stored `hoursSpent` is audit only — time the task stood in progress,
    // which nothing charges. The worklog total is the one figure every screen
    // quotes, so the grid can never claim hours the contract never saw.
    const { service, prisma } = build(taskRow(), [], 2.5);
    prisma.ticketTask.findMany.mockResolvedValue([
      { ...taskRow({ status: 'DONE', hoursSpent: 10.72 }), _count: { comments: 2 } },
    ]);

    const [task] = await service.list(TICKET_ID, CLIENT_ID, assignee);

    expect(task.hoursSpent).toBe(2.5);
    expect(task.commentCount).toBe(2);
  });

  it('shows nothing for a task no time was booked against', async () => {
    const { service, prisma } = build(taskRow());
    prisma.ticketWorklog.groupBy.mockResolvedValue([]);
    prisma.ticketTask.findMany.mockResolvedValue([
      { ...taskRow({ status: 'OPEN', hoursSpent: 1.5 }), _count: { comments: 0 } },
    ]);

    const [task] = await service.list(TICKET_ID, CLIENT_ID, assignee);

    expect(task.hoursSpent).toBe(0);
  });

  it('shows a plain agent only the tasks assigned to them', async () => {
    // An agent lands on a ticket because a task on it is theirs; the rest of the
    // board is somebody else's work and is not theirs to read.
    const { service, prisma } = build(taskRow());
    prisma.ticketTechnician.findFirst.mockResolvedValue(null); // holds no ticket
    prisma.ticketTask.findMany.mockResolvedValue([]);

    await service.list(TICKET_ID, CLIENT_ID, otherAgent);

    expect(prisma.ticketTask.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ticketId: TICKET_ID, assigneeUserId: otherAgent.id },
      }),
    );
  });

  it('shows the whole board to the agent the ticket is assigned to', async () => {
    // They resolve the ticket and may reopen a completed task on it — both rights
    // are meaningless if the tasks they delegated are hidden from them.
    const { service, prisma } = build(taskRow());
    prisma.ticketTask.findMany.mockResolvedValue([]);

    await service.list(TICKET_ID, CLIENT_ID, assignee);

    expect(prisma.ticketTask.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ticketId: TICKET_ID } }),
    );
  });

  it('shows the whole board to an admin without asking who holds the ticket', async () => {
    const { service, prisma } = build(taskRow());
    prisma.ticketTask.findMany.mockResolvedValue([]);

    await service.list(TICKET_ID, CLIENT_ID, admin);

    expect(prisma.ticketTechnician.findFirst).not.toHaveBeenCalled();
    expect(prisma.ticketTask.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ticketId: TICKET_ID } }),
    );
  });
});

describe('TasksService — creating a task', () => {
  it('numbers the task max+1 and keeps the estimate it was raised with', async () => {
    // max+1, never a count: deleting a task must not hand its Task ID to the next
    // one, or a comment naming T-003 would come to mean a different task.
    const { service, prisma } = build(taskRow());

    await service.create(
      TICKET_ID, CLIENT_ID,
      { title: 'Swap the drive', estimatedHours: 1.5 },
      assignee.id, assignee,
    );

    const { data } = prisma.ticketTask.create.mock.calls[0][0];
    expect(data.taskNumber).toBe(3);
    expect(data.estimatedHours).toBe(1.5);
  });
});
