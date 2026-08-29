import { ForbiddenException } from '@nestjs/common';
import { TasksService, hoursFromEvents } from './tasks.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { TicketsService, TicketViewer } from '../tickets/tickets.service';
import type { ActivityService } from '../activity/activity.service';

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
      update: jest.fn().mockImplementation(({ data }: { data: TaskRow }) => ({ ...task, ...data })),
      delete: jest.fn().mockResolvedValue(task),
    },
    ticketTaskStatusEvent: {
      create: jest.fn().mockImplementation(({ data }: { data: { toStatus: string; at: Date } }) => {
        trail.push({ toStatus: data.toStatus, at: data.at });
        return data;
      }),
      findMany: jest.fn().mockImplementation(() => Promise.resolve(trail)),
      // The last stamp is where `bookRunningStretch` measures the closing stretch
      // from — the entry that put the task IN_PROGRESS.
      findFirst: jest.fn().mockImplementation(() => Promise.resolve(trail[trail.length - 1] ?? null)),
    },
    // The task's own hours are derived from the trail; the billable figure the
    // DONE gate checks is the worklog total. `worklogHours` lets a test say the
    // timer has already booked time against the task.
    ticketWorklog: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { hours: worklogHours } }),
      // What the grid quotes as Time spent: the hours the timer actually booked
      // against the task, not the trail it derives its stored figure from.
      groupBy: jest.fn().mockResolvedValue([
        { taskId: 'task-1', _sum: { hours: worklogHours } },
      ]),
    },
    ticket: { findUniqueOrThrow: jest.fn().mockResolvedValue({ clientId: CLIENT_ID }) },
    user: { findUnique: jest.fn().mockResolvedValue({ username: 'agent1' }) },
  };
  const tickets = {
    findOne: jest.fn().mockResolvedValue({ id: TICKET_ID, clientId: CLIENT_ID }),
    // Leaving IN_PROGRESS books the elapsed stretch through here — the timer is
    // the billable record now.
    addWorklog: jest.fn().mockResolvedValue({ id: 'wl-1' }),
  };
  const activity = { log: jest.fn().mockResolvedValue(undefined) };

  const service = new TasksService(
    prisma as unknown as PrismaService,
    tickets as unknown as TicketsService,
    activity as unknown as ActivityService,
  );
  return { service, prisma, tickets, activity, trail };
}

const assignee: TicketViewer = { id: 'agent-1', roles: ['Viewer'] };
const otherAgent: TicketViewer = { id: 'agent-9', roles: ['Viewer'] };
const admin: TicketViewer = { id: 'admin-1', roles: ['Admin'] };

const hoursAgo = (n: number) => new Date(Date.now() - n * 3_600_000);
const move = (service: TasksService, status: string, viewer: TicketViewer = assignee) =>
  service.update(TICKET_ID, 'task-1', CLIENT_ID, { status }, viewer.id, viewer);

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

  it('books the running stretch to a worklog when the timer stops', async () => {
    // Leaving IN_PROGRESS is what charges the pool now: the elapsed since the
    // task entered the running state is booked through `addWorklog`, so the timer
    // — not a hand-typed figure — is the billable record.
    const { service, tickets } = build(
      taskRow({ status: 'IN_PROGRESS' }),
      [{ toStatus: 'IN_PROGRESS', at: hoursAgo(2) }],
    );

    await move(service, 'OPEN');

    expect(tickets.addWorklog).toHaveBeenCalledTimes(1);
    const [ticketId, dto] = tickets.addWorklog.mock.calls[0];
    expect(ticketId).toBe(TICKET_ID);
    expect(dto.taskId).toBe('task-1');
    expect(dto.hours).toBeCloseTo(2, 1);
  });

  it('books nothing when a status change does not leave the running state', async () => {
    const { service, tickets } = build(taskRow({ status: 'OPEN' }));

    await move(service, 'IN_PROGRESS');

    expect(tickets.addWorklog).not.toHaveBeenCalled();
  });

  it('blocks marking a task done when the timer booked no time', async () => {
    // A task that never ran has no worklog behind it, so the DONE gate refuses it
    // — settling it would under-bill the contract.
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
  it('adds the stretch still running to what the task has booked', async () => {
    const { service, prisma } = build(taskRow(), [], 2);
    prisma.ticketTask.findMany.mockResolvedValue([
      {
        ...taskRow({ status: 'IN_PROGRESS' }),
        _count: { comments: 2 },
        statusEvents: [
          { toStatus: 'OPEN', at: hoursAgo(5) },
          { toStatus: 'IN_PROGRESS', at: hoursAgo(1) },
        ],
      },
    ]);

    const [task] = await service.list(TICKET_ID, CLIENT_ID, assignee);

    // 2h booked + the open hour. Only the open stretch is added — the closed one
    // is already a worklog, so counting it off the trail as well would double it.
    expect(task.hoursSpent).toBe(3);
    expect(task.commentCount).toBe(2);
  });

  it('quotes the booked hours once the task has stopped, not the stored trail figure', async () => {
    // The stored `hoursSpent` is audit only, and a stretch the timer never
    // managed to book must not inflate the grid past what the contract was
    // charged — the worklog total is the one figure every screen quotes.
    const { service, prisma } = build(taskRow(), [], 2.5);
    prisma.ticketTask.findMany.mockResolvedValue([
      {
        ...taskRow({ status: 'DONE', hoursSpent: 10.72 }),
        _count: { comments: 0 },
        statusEvents: [
          { toStatus: 'IN_PROGRESS', at: hoursAgo(4) },
          { toStatus: 'DONE', at: hoursAgo(1.5) },
        ],
      },
    ]);

    const [task] = await service.list(TICKET_ID, CLIENT_ID, assignee);

    expect(task.hoursSpent).toBe(2.5);
  });

  it('shows nothing for a task the timer never booked against', async () => {
    const { service, prisma } = build(taskRow());
    prisma.ticketWorklog.groupBy.mockResolvedValue([]);
    prisma.ticketTask.findMany.mockResolvedValue([
      { ...taskRow({ status: 'OPEN', hoursSpent: 1.5 }), _count: { comments: 0 }, statusEvents: [] },
    ]);

    const [task] = await service.list(TICKET_ID, CLIENT_ID, assignee);

    expect(task.hoursSpent).toBe(0);
  });
});
