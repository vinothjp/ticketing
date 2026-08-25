import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { TicketsService, type TicketViewer } from './tickets.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { TemplatesService } from '../templates/templates.service';
import type { ActivityService } from '../activity/activity.service';
import type { MailerService } from '../mail/mailer.service';
import type { ProductsService } from '../products/products.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { CustomerProductsService } from '../customer-companies/customer-products.service';

const CLIENT_ID = 'tenant-1';
const COMPANY_ID = 'company-1';

// The seeded status master: value === label, which is what statusLabel() reads.
const STATUS_OPTIONS = [
  { value: 'Open', label: 'Open' },
  { value: 'Resolved', label: 'Resolved' },
  { value: 'Closed', label: 'Closed' },
];

type TicketRow = Record<string, unknown>;

function ticketRow(overrides: TicketRow = {}): TicketRow {
  return {
    id: 'ticket-1',
    clientId: CLIENT_ID,
    ticketNumber: 'T-000001',
    subject: 'Printer offline',
    ticketStatus: 'Resolved',
    customerCompanyId: COMPANY_ID,
    requestorUserId: 'contact-1',
    requestorEmail: 'contact@acme.test',
    requestorName: 'Ada',
    resolution: 'Replaced the driver',
    resolvedAt: new Date('2026-08-20T09:00:00Z'),
    resolvedById: 'agent-1',
    acknowledgedAt: null,
    closedDate: null,
    productId: null,
    moduleId: null,
    technicians: [],
    ...overrides,
  };
}

function build(
  ticket: TicketRow,
  statusOptions = STATUS_OPTIONS,
  loggedHours: number | null = 2.5,
  reopenWindowDays = 30,
  autoCloseDays = 3,
  // Tasks still neither done nor cancelled. Zero is the ordinary case: a ticket
  // with nothing outstanding resolves exactly as it always did.
  openTasks = 0,
) {
  const prisma = {
    client: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ ticketReopenWindowDays: reopenWindowDays, ticketAutoCloseDays: autoCloseDays }),
      // The auto-close sweep walks every tenant.
      findMany: jest.fn().mockResolvedValue([{ id: CLIENT_ID, ticketAutoCloseDays: autoCloseDays }]),
    },
    ticketWorklog: { aggregate: jest.fn().mockResolvedValue({ _sum: { hours: loggedHours } }) },
    ticketTask: { count: jest.fn().mockResolvedValue(openTasks) },
    ticket: {
      findFirst: jest.fn().mockResolvedValue(ticket),
      // What the sweep's cutoff query returns.
      findMany: jest.fn().mockResolvedValue([ticket]),
      update: jest.fn().mockImplementation(({ data }: { data: TicketRow }) => ({ ...ticket, ...data })),
    },
    picklistOption: {
      findFirst: jest
        .fn()
        .mockImplementation(({ where }: { where: { value?: string } }) =>
          statusOptions.find((o) => o.value === where.value) ?? null,
        ),
      findMany: jest.fn().mockResolvedValue(statusOptions),
    },
    ticketTechnician: {
      findMany: jest.fn().mockResolvedValue([{ userId: 'agent-1' }]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    user: {
      findMany: jest.fn().mockResolvedValue([{ id: 'company-admin-1' }]),
      count: jest.fn().mockResolvedValue(0),
    },
    product: { findUnique: jest.fn() },
    productModule: { findUnique: jest.fn() },
  };
  const activity = { log: jest.fn().mockResolvedValue(undefined) };
  const notifications = {
    notify: jest.fn().mockResolvedValue(undefined),
    notifyMany: jest.fn().mockResolvedValue(undefined),
  };
  const mailer = { isConfigured: jest.fn().mockResolvedValue(false), sendMail: jest.fn() };

  const service = new TicketsService(
    prisma as unknown as PrismaService,
    {} as TemplatesService,
    activity as unknown as ActivityService,
    mailer as unknown as MailerService,
    {} as ProductsService,
    notifications as unknown as NotificationsService,
    {} as CustomerProductsService,
  );
  return { service, prisma, activity, notifications, mailer };
}

// The company's own admin — allowed to acknowledge any of their company's tickets.
const contact: TicketViewer = { id: 'contact-1', roles: ['CustomerAdmin'], customerCompanyId: COMPANY_ID };
// Every reopen carries a reason; the agents are notified with it.
const REASON = 'The printer went offline again the next morning';

describe('TicketsService — client acknowledgement', () => {
  it('closes a resolved ticket and stamps who acknowledged it', async () => {
    const { service, prisma, activity, notifications } = build(ticketRow());

    const updated = await service.acknowledge('ticket-1', CLIENT_ID, contact.id, contact);

    const data = prisma.ticket.update.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.ticketStatus).toBe('Closed');
    expect(data.acknowledgedById).toBe('contact-1');
    expect(data.acknowledgedAt).toBeInstanceOf(Date);
    // The close stamp and the acknowledgement are the same moment.
    expect(data.closedDate).toEqual(data.acknowledgedAt);
    expect(updated.ticketStatus).toBe('Closed');

    const types = activity.log.mock.calls.map((c) => (c[0] as { type: string }).type);
    expect(types).toEqual(['ACKNOWLEDGED', 'CLOSED']);
    // The agents who worked it are told the client signed off.
    expect(notifications.notifyMany).toHaveBeenCalledWith(
      expect.arrayContaining(['agent-1']),
      expect.objectContaining({ type: 'TICKET_ACKNOWLEDGED', clientId: CLIENT_ID }),
    );
  });

  it('uses the tenant own Closed status value rather than the literal "Closed"', async () => {
    const { service, prisma } = build(ticketRow(), [
      { value: 'OPEN', label: 'Open' },
      { value: 'RES', label: 'Resolved' },
      { value: 'CLS', label: 'Closed' },
    ]);
    // The ticket sits on this tenant's resolved value.
    prisma.ticket.findFirst.mockResolvedValue(ticketRow({ ticketStatus: 'RES' }));

    await service.acknowledge('ticket-1', CLIENT_ID, contact.id, contact);

    const data = prisma.ticket.update.mock.calls[0][0].data as { ticketStatus: string };
    expect(data.ticketStatus).toBe('CLS');
  });

  it('rejects a second acknowledgement', async () => {
    const { service, prisma } = build(ticketRow({ acknowledgedAt: new Date('2026-08-20T10:00:00Z') }));

    await expect(service.acknowledge('ticket-1', CLIENT_ID, contact.id, contact)).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  it('rejects acknowledgement of a ticket that is not resolved', async () => {
    const { service, prisma } = build(ticketRow({ ticketStatus: 'Open', resolvedAt: null }));

    await expect(service.acknowledge('ticket-1', CLIENT_ID, contact.id, contact)).rejects.toThrow(
      /Only a resolved ticket can be acknowledged/,
    );
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  it('rejects acknowledgement of an already-closed ticket', async () => {
    const { service, prisma } = build(
      ticketRow({ ticketStatus: 'Closed', closedDate: new Date('2026-08-20T11:00:00Z') }),
    );

    await expect(service.acknowledge('ticket-1', CLIENT_ID, contact.id, contact)).rejects.toThrow(
      /already closed/,
    );
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  it('refuses a contact from another customer company', async () => {
    const { service, prisma } = build(ticketRow());
    const outsider: TicketViewer = {
      id: 'contact-9',
      roles: ['CustomerAdmin'],
      customerCompanyId: 'company-2',
    };

    await expect(service.acknowledge('ticket-1', CLIENT_ID, outsider.id, outsider)).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  it('refuses an employee acknowledging a colleague ticket', async () => {
    const { service, prisma } = build(ticketRow({ requestorUserId: 'colleague-1' }));
    const employee: TicketViewer = { id: 'contact-2', roles: ['Customer'], customerCompanyId: COMPANY_ID };

    await expect(service.acknowledge('ticket-1', CLIENT_ID, employee.id, employee)).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  it('clears the sign-off on reopen so the next resolution can be acknowledged', async () => {
    const { service, prisma } = build(ticketRow());

    await service.reopen('ticket-1', CLIENT_ID, { reason: REASON }, 'contact-1', contact);

    const data = prisma.ticket.update.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.acknowledgedAt).toBeNull();
    expect(data.acknowledgedById).toBeNull();
  });
});

describe('TicketsService — reopen window', () => {
  const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

  it('reopens a ticket resolved inside the tenant window', async () => {
    const { service, prisma } = build(ticketRow({ resolvedAt: daysAgo(29) }));

    await service.reopen('ticket-1', CLIENT_ID, { reason: REASON }, 'contact-1', contact);

    expect(prisma.ticket.update).toHaveBeenCalled();
  });

  it('refuses a reopen once the window has closed, pointing at a new ticket', async () => {
    const { service, prisma } = build(ticketRow({ resolvedAt: daysAgo(31) }));

    await expect(service.reopen('ticket-1', CLIENT_ID, { reason: REASON }, 'contact-1', contact)).rejects.toThrow(
      /30 days ago and can no longer be reopened/,
    );
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  it('honours a tenant that widened the window', async () => {
    const { service, prisma } = build(ticketRow({ resolvedAt: daysAgo(31) }), STATUS_OPTIONS, 2.5, 90);

    await service.reopen('ticket-1', CLIENT_ID, { reason: REASON }, 'contact-1', contact);

    expect(prisma.ticket.update).toHaveBeenCalled();
  });

  it('projects the window onto the ticket so the screen can gate the button', async () => {
    const resolvedAt = daysAgo(31);
    const { service } = build(ticketRow({ resolvedAt }));

    const ticket = (await service.findOne('ticket-1', CLIENT_ID, contact)) as unknown as {
      reopenWindowDays: number; reopenDeadline: Date; reopenWindowOpen: boolean;
    };

    expect(ticket.reopenWindowDays).toBe(30);
    expect(ticket.reopenWindowOpen).toBe(false);
    expect(ticket.reopenDeadline.getTime()).toBe(resolvedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
  });
});

describe('TicketsService — reopen reason', () => {
  it('refuses a reopen with no reason', async () => {
    const { service, prisma } = build(ticketRow());

    await expect(
      service.reopen('ticket-1', CLIENT_ID, { reason: '   ' }, 'contact-1', contact),
    ).rejects.toThrow(/why this ticket needs to be reopened/);
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  it('stores the reason and pushes it to the agents and admins', async () => {
    const { service, prisma, activity, notifications } = build(ticketRow());

    await service.reopen('ticket-1', CLIENT_ID, { reason: `  ${REASON}  ` }, 'contact-1', contact);

    const data = prisma.ticket.update.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.reopenReason).toBe(REASON); // trimmed
    expect(data.reopenedById).toBe('contact-1');
    expect(data.reopenedAt).toBeInstanceOf(Date);
    // The history carries it too, so it survives the next reopen overwriting the column.
    expect(activity.log).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'REOPENED', summary: `Ticket reopened: ${REASON}` }),
    );
    // agent-1 is both the assigned technician and the resolver; company-admin-1 is a tenant Admin.
    expect(notifications.notifyMany).toHaveBeenCalledWith(
      expect.arrayContaining(['agent-1', 'company-admin-1']),
      expect.objectContaining({ type: 'TICKET_REOPENED', ticketId: 'ticket-1' }),
    );
    const body = notifications.notifyMany.mock.calls.at(-1)![1] as { body: string };
    expect(body.body).toContain(REASON);
  });

  it('does not notify the client who reopened it', async () => {
    const { service, notifications } = build(ticketRow());

    await service.reopen('ticket-1', CLIENT_ID, { reason: REASON }, 'contact-1', contact);

    const [recipients] = notifications.notifyMany.mock.calls.at(-1)!;
    expect(recipients).not.toContain('contact-1');
  });
});

describe('TicketsService — only the client may reopen', () => {
  it('lets a customer employee reopen their own ticket', async () => {
    const { service, prisma } = build(ticketRow());
    const employee: TicketViewer = { id: 'contact-1', roles: ['Customer'], customerCompanyId: COMPANY_ID };

    await service.reopen('ticket-1', CLIENT_ID, { reason: REASON }, employee.id, employee);

    expect(prisma.ticket.update).toHaveBeenCalled();
  });

  it('refuses a provider admin reopening on the client behalf', async () => {
    const { service, prisma } = build(ticketRow());
    const admin: TicketViewer = { id: 'agent-1', roles: ['Admin'] };

    await expect(service.reopen('ticket-1', CLIENT_ID, { reason: REASON }, admin.id, admin)).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  it('still lets staff reopen an internal ticket, which has no client to ask', async () => {
    const { service, prisma } = build(ticketRow({ customerCompanyId: null }));
    const admin: TicketViewer = { id: 'agent-1', roles: ['Admin'] };

    await service.reopen('ticket-1', CLIENT_ID, { reason: REASON }, admin.id, admin);

    expect(prisma.ticket.update).toHaveBeenCalled();
  });

  it('refuses a consultant reopening a ticket they worked', async () => {
    // Assigned to them, so findOne lets them through — the reopen rule is what stops them.
    const { service, prisma } = build(ticketRow({ technicians: [{ user: { id: 'agent-1' } }] }));
    const consultant: TicketViewer = { id: 'agent-1', roles: ['Viewer'] };

    await expect(service.reopen('ticket-1', CLIENT_ID, { reason: REASON }, consultant.id, consultant)).rejects.toThrow(
      /Only the client can reopen their own ticket/,
    );
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });
});

describe('TicketsService — resolution notifies the client', () => {
  const agent: TicketViewer = { id: 'agent-1', roles: ['Admin'] };

  it('notifies the requestor and their company admins when the status moves to Resolved', async () => {
    const { service, prisma, notifications } = build(
      ticketRow({ ticketStatus: 'Open', resolvedAt: null, resolvedById: null }),
    );

    await service.update('ticket-1', CLIENT_ID, { ticketStatus: 'Resolved' }, agent.id, agent);

    const data = prisma.ticket.update.mock.calls[0][0].data as Record<string, unknown>;
    // The status dropdown stamps the same fields the Resolution tab does.
    expect(data.resolvedAt).toBeInstanceOf(Date);
    expect(data.resolvedById).toBe('agent-1');
    expect(notifications.notifyMany).toHaveBeenCalledWith(
      expect.arrayContaining(['contact-1', 'company-admin-1']),
      expect.objectContaining({ type: 'TICKET_RESOLVED', ticketId: 'ticket-1', clientId: CLIENT_ID }),
    );
  });

  it('does not re-notify when an already-resolved ticket changes status again', async () => {
    const { service, notifications } = build(ticketRow({ ticketStatus: 'Resolved' }));

    await service.update('ticket-1', CLIENT_ID, { ticketStatus: 'Open' }, agent.id, agent);

    expect(notifications.notifyMany).not.toHaveBeenCalled();
  });

  it('does not re-notify when the resolution notes are edited', async () => {
    const { service, notifications } = build(ticketRow());

    await service.setResolution('ticket-1', CLIENT_ID, { resolution: 'Updated note' }, agent.id, agent);

    expect(notifications.notifyMany).not.toHaveBeenCalled();
  });

  it('notifies on the first resolution saved from the Resolution tab', async () => {
    const { service, notifications } = build(
      ticketRow({ ticketStatus: 'Open', resolvedAt: null, resolvedById: null }),
    );

    await service.setResolution('ticket-1', CLIENT_ID, { resolution: 'Fixed' }, agent.id, agent);

    expect(notifications.notifyMany).toHaveBeenCalledWith(
      expect.arrayContaining(['contact-1']),
      expect.objectContaining({ type: 'TICKET_RESOLVED' }),
    );
  });
});

describe('TicketsService — resolving/closing requires logged time', () => {
  const agent: TicketViewer = { id: 'agent-1', roles: ['Admin'] };
  const openTicket = () => ticketRow({ ticketStatus: 'Open', resolvedAt: null, resolvedById: null });

  it('refuses to resolve a ticket with an empty timesheet', async () => {
    const { service, prisma } = build(openTicket(), STATUS_OPTIONS, null);

    await expect(
      service.setResolution('ticket-1', CLIENT_ID, { resolution: 'Fixed' }, agent.id, agent),
    ).rejects.toThrow(/Log the time spent on this ticket before marking it resolved/);
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  it('refuses a status change to Resolved with no logged time', async () => {
    const { service, prisma } = build(openTicket(), STATUS_OPTIONS, 0);

    await expect(
      service.update('ticket-1', CLIENT_ID, { ticketStatus: 'Resolved' }, agent.id, agent),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  // A staff close only reaches the timesheet rule on an internal ticket — a client's
  // ticket is stopped earlier, by the acknowledgement rule.
  it('refuses a status change to Closed with no logged time', async () => {
    const { service, prisma } = build(
      ticketRow({ ticketStatus: 'Open', resolvedAt: null, resolvedById: null, customerCompanyId: null }),
      STATUS_OPTIONS,
      0,
    );

    await expect(
      service.update('ticket-1', CLIENT_ID, { ticketStatus: 'Closed' }, agent.id, agent),
    ).rejects.toThrow(/before marking it closed/);
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  it('allows resolving once time is logged', async () => {
    const { service, prisma } = build(openTicket(), STATUS_OPTIONS, 0.25);

    await service.update('ticket-1', CLIENT_ID, { ticketStatus: 'Resolved' }, agent.id, agent);

    expect(prisma.ticket.update).toHaveBeenCalled();
  });

  it('leaves other status changes alone', async () => {
    const { service, prisma } = build(openTicket(), STATUS_OPTIONS, null);

    await service.update('ticket-1', CLIENT_ID, { ticketStatus: 'In Progress' }, agent.id, agent);

    expect(prisma.ticket.update).toHaveBeenCalled();
    // findOne reads the worklog total for every ticket it returns, so the gate is
    // the *second* aggregate — one call means assertTimeLogged never ran.
    expect(prisma.ticketWorklog.aggregate).toHaveBeenCalledTimes(1);
    expect(prisma.ticketTask.count).toHaveBeenCalledTimes(1);
  });

  it('does not block editing notes on a ticket resolved before the rule existed', async () => {
    const { service, prisma } = build(ticketRow(), STATUS_OPTIONS, null);

    await service.setResolution('ticket-1', CLIENT_ID, { resolution: 'Updated note' }, agent.id, agent);

    expect(prisma.ticket.update).toHaveBeenCalled();
  });

  it('does not hold the client sign-off to the staff timesheet rule', async () => {
    const { service, prisma } = build(ticketRow(), STATUS_OPTIONS, null);

    await service.acknowledge('ticket-1', CLIENT_ID, contact.id, contact);

    expect((prisma.ticket.update.mock.calls[0][0].data as { ticketStatus: string }).ticketStatus).toBe('Closed');
  });
});

describe('TicketsService — a client ticket closes only on acknowledgement', () => {
  const agent: TicketViewer = { id: 'agent-1', roles: ['Admin'] };
  const CLOSE_ERROR = /only their acknowledgement can close it/;

  it('rejects a staff status change to Closed on a client ticket', async () => {
    const { service, prisma } = build(ticketRow({ ticketStatus: 'Resolved' }));

    await expect(
      service.update('ticket-1', CLIENT_ID, { ticketStatus: 'Closed' }, agent.id, agent),
    ).rejects.toThrow(CLOSE_ERROR);
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  it('rejects the close before the timesheet rule, so the message names the real blocker', async () => {
    // No logged time either — the acknowledgement rule is the one that matters here.
    const { service } = build(ticketRow({ ticketStatus: 'Resolved' }), STATUS_OPTIONS, null);

    await expect(
      service.update('ticket-1', CLIENT_ID, { ticketStatus: 'Closed' }, agent.id, agent),
    ).rejects.toThrow(CLOSE_ERROR);
  });

  it('rejects a close smuggled through the resolution endpoint', async () => {
    const { service, prisma } = build(ticketRow({ ticketStatus: 'Open', resolvedAt: null, resolvedById: null }));

    await expect(
      service.setResolution('ticket-1', CLIENT_ID, { resolution: 'Done', ticketStatus: 'Closed' }, agent.id, agent),
    ).rejects.toThrow(CLOSE_ERROR);
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  it('still lets staff resolve a client ticket', async () => {
    const { service, prisma } = build(ticketRow({ ticketStatus: 'Open', resolvedAt: null, resolvedById: null }));

    await service.update('ticket-1', CLIENT_ID, { ticketStatus: 'Resolved' }, agent.id, agent);

    const data = prisma.ticket.update.mock.calls[0][0].data as { ticketStatus: string };
    expect(data.ticketStatus).toBe('Resolved');
  });

  it('lets staff close an internal ticket that has no client', async () => {
    const { service, prisma } = build(
      ticketRow({ ticketStatus: 'Resolved', customerCompanyId: null, requestorUserId: null }),
    );

    await service.update('ticket-1', CLIENT_ID, { ticketStatus: 'Closed' }, agent.id, agent);

    const data = prisma.ticket.update.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.ticketStatus).toBe('Closed');
    expect(data.closedDate).toBeInstanceOf(Date);
  });

  it('still holds an internal close to the timesheet rule', async () => {
    const { service, prisma } = build(
      ticketRow({ ticketStatus: 'Resolved', customerCompanyId: null }),
      STATUS_OPTIONS,
      null,
    );

    await expect(
      service.update('ticket-1', CLIENT_ID, { ticketStatus: 'Closed' }, agent.id, agent),
    ).rejects.toThrow(/before marking it closed/);
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  it('leaves the client acknowledgement as the way a client ticket closes', async () => {
    const { service, prisma } = build(ticketRow());

    await service.acknowledge('ticket-1', CLIENT_ID, contact.id, contact);

    const data = prisma.ticket.update.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.ticketStatus).toBe('Closed');
    expect(data.closedDate).toBeInstanceOf(Date);
  });
});

describe('TicketsService — auto-close of unacknowledged resolutions', () => {
  // The row the sweep picks up: resolved, never acknowledged, still open, and
  // resolved longer ago than the tenant's window.
  const stale = () => ticketRow({ resolvedAt: new Date(Date.now() - 5 * 24 * 3600 * 1000) });

  it('closes a client ticket whose resolution went unacknowledged past the window', async () => {
    const { service, prisma, activity, notifications } = build(stale());

    const { closed } = await service.autoCloseUnacknowledged();

    expect(closed).toBe(1);
    const data = prisma.ticket.update.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.ticketStatus).toBe('Closed');
    expect(data.closedDate).toBeInstanceOf(Date);
    // No acknowledgement was ever made, so nothing may claim one.
    expect(data.acknowledgedAt).toBeUndefined();
    expect(activity.log.mock.calls.map((c) => (c[0] as { type: string }).type)).toEqual(['CLOSED']);
    // Both sides hear about it — the client's people and the agents who worked it.
    expect(notifications.notifyMany).toHaveBeenCalledWith(
      expect.arrayContaining(['contact-1', 'agent-1']),
      expect.objectContaining({ type: 'TICKET_CLOSED', clientId: CLIENT_ID }),
    );
  });

  it('only ever looks at client tickets that are still awaiting a sign-off', async () => {
    const { service, prisma } = build(stale());

    await service.autoCloseUnacknowledged();

    const where = prisma.ticket.findMany.mock.calls[0][0].where as Record<string, unknown>;
    // An internal ticket has no client to ask — staff close those directly.
    expect(where.customerCompanyId).toEqual({ not: null });
    expect(where.acknowledgedAt).toBeNull();
    expect(where.closedDate).toBeNull();
    expect((where.resolvedAt as { lte: Date }).lte.getTime()).toBeLessThan(Date.now());
  });

  it('leaves a ticket alone once it is no longer resolved', async () => {
    // Moving a ticket back to Open leaves resolvedAt in place, so the live status
    // is what decides — otherwise work in progress would close under the agent.
    const { service, prisma } = build(ticketRow({
      ticketStatus: 'Open',
      resolvedAt: new Date(Date.now() - 5 * 24 * 3600 * 1000),
    }));

    const { closed } = await service.autoCloseUnacknowledged();

    expect(closed).toBe(0);
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  it('measures the cutoff from the tenant own setting', async () => {
    const { service, prisma } = build(stale(), STATUS_OPTIONS, 2.5, 30, 10);

    await service.autoCloseUnacknowledged();

    const where = prisma.ticket.findMany.mock.calls[0][0].where as { resolvedAt: { lte: Date } };
    const days = (Date.now() - where.resolvedAt.lte.getTime()) / (24 * 3600 * 1000);
    // The cutoff is what keeps a fresher resolution out of the sweep — the date
    // filter itself is the DB's job, so this is where it has to be right.
    expect(days).toBeCloseTo(10, 1);
  });
});

describe('TicketsService — resolving requires outstanding tasks to be settled', () => {
  const agent: TicketViewer = { id: 'agent-1', roles: ['Admin'] };
  const openTicket = () => ticketRow({ ticketStatus: 'Open', resolvedAt: null, resolvedById: null });

  it('refuses to resolve a ticket with an open task', async () => {
    const { service, prisma } = build(openTicket(), STATUS_OPTIONS, 2.5, 30, 3, 1);

    await expect(
      service.setResolution('ticket-1', CLIENT_ID, { resolution: 'Fixed' }, agent.id, agent),
    ).rejects.toThrow(/1 task is still open on this ticket — complete or cancel it/);
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  it('pluralises the refusal for several open tasks', async () => {
    const { service } = build(openTicket(), STATUS_OPTIONS, 2.5, 30, 3, 3);

    await expect(
      service.update('ticket-1', CLIENT_ID, { ticketStatus: 'Resolved' }, agent.id, agent),
    ).rejects.toThrow(/3 tasks are still open on this ticket — complete or cancel them/);
  });

  it('blocks the status-dropdown door as well as the Resolution tab', async () => {
    const { service, prisma } = build(openTicket(), STATUS_OPTIONS, 2.5, 30, 3, 1);

    await expect(
      service.update('ticket-1', CLIENT_ID, { ticketStatus: 'Resolved' }, agent.id, agent),
    ).rejects.toThrow(/still open/);
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  it('counts only tasks that are neither done nor cancelled', async () => {
    const { service, prisma } = build(openTicket(), STATUS_OPTIONS, 2.5, 30, 3, 0);

    await service.setResolution('ticket-1', CLIENT_ID, { resolution: 'Fixed' }, agent.id, agent);

    expect(prisma.ticket.update).toHaveBeenCalled();
    expect(prisma.ticketTask.count).toHaveBeenCalledWith({
      where: { ticketId: 'ticket-1', status: { notIn: ['DONE', 'CANCELLED'] } },
    });
  });

  it('lets a ticket with no tasks resolve exactly as before', async () => {
    const { service, prisma } = build(openTicket(), STATUS_OPTIONS, 2.5);

    await service.update('ticket-1', CLIENT_ID, { ticketStatus: 'Resolved' }, agent.id, agent);

    expect(prisma.ticket.update).toHaveBeenCalled();
  });

  it('does not block editing notes on a ticket resolved before the rule existed', async () => {
    // Already resolved, and carrying an open task it never had to answer for.
    const { service, prisma } = build(ticketRow(), STATUS_OPTIONS, 2.5, 30, 3, 2);

    await service.setResolution('ticket-1', CLIENT_ID, { resolution: 'Updated note' }, agent.id, agent);

    expect(prisma.ticket.update).toHaveBeenCalled();
  });
});

describe('TicketsService — reassignment tells everyone waiting on the ticket', () => {
  const admin: TicketViewer = { id: 'admin-1', roles: ['Admin'] };
  const openTicket = () =>
    ticketRow({ ticketStatus: 'Open', resolvedAt: null, resolvedById: null, approvalStatus: 'NONE' });

  /** Wire the user/technician lookups assignTechnicians makes, in call order. */
  function wireAssignment(
    prisma: ReturnType<typeof build>['prisma'],
    previous: { id: string; username: string; email: string | null }[],
    incoming: { id: string; username: string; email: string | null }[],
  ) {
    prisma.ticketTechnician.findMany.mockResolvedValue(previous.map((u) => ({ user: u })));
    prisma.user.count.mockResolvedValue(incoming.length);
    prisma.user.findMany
      // the incoming agents, for the activity summary
      .mockResolvedValueOnce(incoming)
      // then the CustomerAdmins, then the tenant Admins
      .mockResolvedValueOnce([{ id: 'company-admin-1', email: 'ada@acme.test' }])
      .mockResolvedValueOnce([{ id: 'admin-1', email: 'pm@provider.test' }]);
  }

  const AGENT_1 = { id: 'agent-1', username: 'agent1', email: 'a1@provider.test' };
  const AGENT_2 = { id: 'agent-2', username: 'agent2', email: 'a2@provider.test' };

  it('tells the incoming agent, the outgoing agent and everyone watching', async () => {
    const { service, prisma, notifications } = build(openTicket());
    wireAssignment(prisma, [AGENT_1], [AGENT_2]);

    await service.assignTechnicians('ticket-1', CLIENT_ID, ['agent-2'], admin.id, admin);

    // The agent who now owns it.
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'agent-2', type: 'TICKET_ASSIGNED', ticketId: 'ticket-1' }),
    );
    // The agent it left.
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'agent-1', type: 'TICKET_UNASSIGNED' }),
    );
    // The requestor, the client's own admin and the provider's PM.
    const [recipients, payload] = notifications.notifyMany.mock.calls[0];
    expect(recipients).toEqual(expect.arrayContaining(['contact-1', 'company-admin-1']));
    expect(payload).toEqual(expect.objectContaining({ type: 'TICKET_REASSIGNED' }));
    expect(payload.body).toMatch(/has moved from agent1 to agent2/);
  });

  it('never pings the person who performed the change', async () => {
    const { service, prisma, notifications } = build(openTicket());
    wireAssignment(prisma, [AGENT_1], [AGENT_2]);

    await service.assignTechnicians('ticket-1', CLIENT_ID, ['agent-2'], admin.id, admin);

    // admin-1 is a tenant Admin *and* the actor.
    const [recipients] = notifications.notifyMany.mock.calls[0];
    expect(recipients).not.toContain('admin-1');
  });

  it('stays silent when the same agent is re-assigned', async () => {
    const { service, prisma, notifications } = build(openTicket());
    wireAssignment(prisma, [AGENT_2], [AGENT_2]);

    await service.assignTechnicians('ticket-1', CLIENT_ID, ['agent-2'], admin.id, admin);

    expect(notifications.notify).not.toHaveBeenCalled();
    expect(notifications.notifyMany).not.toHaveBeenCalled();
  });

  it('reads a first assignment as an assignment, not a handover', async () => {
    const { service, prisma, notifications } = build(openTicket());
    wireAssignment(prisma, [], [AGENT_1]);

    await service.assignTechnicians('ticket-1', CLIENT_ID, ['agent-1'], admin.id, admin);

    const [, payload] = notifications.notifyMany.mock.calls[0];
    expect(payload.body).toMatch(/has been assigned to agent1/);
    expect(payload.body).not.toMatch(/moved from/);
  });

  it('reads an empty assignment as an unassignment', async () => {
    const { service, prisma, notifications } = build(openTicket());
    wireAssignment(prisma, [AGENT_1], []);

    await service.assignTechnicians('ticket-1', CLIENT_ID, [], admin.id, admin);

    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'agent-1', type: 'TICKET_UNASSIGNED' }),
    );
    const [, payload] = notifications.notifyMany.mock.calls[0];
    expect(payload.title).toBe('Ticket unassigned');
  });

  it('still completes the assignment when SMTP is down', async () => {
    const { service, prisma, mailer } = build(openTicket());
    wireAssignment(prisma, [AGENT_1], [AGENT_2]);
    mailer.isConfigured.mockResolvedValue(false);

    await expect(
      service.assignTechnicians('ticket-1', CLIENT_ID, ['agent-2'], admin.id, admin),
    ).resolves.toBeDefined();
    expect(mailer.sendMail).not.toHaveBeenCalled();
  });

  it('sends the client and the provider separate emails', async () => {
    const { service, prisma, mailer } = build(openTicket());
    wireAssignment(prisma, [AGENT_1], [AGENT_2]);
    mailer.isConfigured.mockResolvedValue(true);
    mailer.sendMail.mockResolvedValue({});

    await service.assignTechnicians('ticket-1', CLIENT_ID, ['agent-2'], admin.id, admin);

    const recipients = mailer.sendMail.mock.calls.map((c) => (c[0] as { to: string }).to);
    expect(recipients).toHaveLength(2);
    // The customer's addresses and the provider's are never in one To: header.
    expect(recipients[0]).toBe('contact@acme.test, ada@acme.test');
    expect(recipients[1]).toBe('pm@provider.test, a2@provider.test');
  });
});
