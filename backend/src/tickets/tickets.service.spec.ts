import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { TicketsService, type TicketViewer } from './tickets.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { TemplatesService } from '../templates/templates.service';
import type { ActivityService } from '../activity/activity.service';
import type { MailerService } from '../mail/mailer.service';
import type { ProductsService } from '../products/products.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { CustomerProductsService } from '../customer-companies/customer-products.service';
import type { NotificationRulesService } from '../notification-rules/notification-rules.service';
import { DEFAULT_RULES } from '../notification-rules/notification-vocab';

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
    // Relative, not a fixed date: the reopen window is measured from now, and a
    // fixed stamp quietly slid outside it a month after it was written.
    resolvedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
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
      create: jest.fn().mockResolvedValue({}),
    },
    // The assignable-agents gate: a module's agents, the client's own consultants.
    moduleConsultant: { findMany: jest.fn().mockResolvedValue([]) },
    productConsultant: { findMany: jest.fn().mockResolvedValue([]) },
    customerConsultant: { findMany: jest.fn().mockResolvedValue([]) },
    ticketTechnician: {
      findMany: jest.fn().mockResolvedValue([{ userId: 'agent-1' }]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    user: {
      // A lookup by ids answers with those users; anything else with the company admin.
      findMany: jest
        .fn()
        .mockImplementation(({ where }: { where?: { id?: { in?: string[] } } } = {}) =>
          where?.id?.in
            ? where.id.in.map((id) => ({ id, username: id, name: null, email: null }))
            : [{ id: 'company-admin-1' }],
        ),
      findUnique: jest
        .fn()
        .mockImplementation(({ where }: { where: { id: string } }) => ({ id: where.id, username: where.id, name: null, email: null, isActive: true })),
      // "Is the actor staff?" — every id in these tests but a client contact's.
      findFirst: jest
        .fn()
        .mockImplementation(({ where }: { where: { id: string } }) => (String(where.id).startsWith('contact') ? null : { id: where.id })),
      count: jest.fn().mockResolvedValue(0),
    },
    customerCompany: { findUnique: jest.fn().mockResolvedValue({ name: 'Acme' }) },
    // The client product's project manager — who decides a reopen request.
    customerCompanyProduct: { findFirst: jest.fn().mockResolvedValue(null) },
    product: { findUnique: jest.fn() },
    productModule: { findUnique: jest.fn() },
  };
  const activity = { log: jest.fn().mockResolvedValue(undefined) };
  const notifications = {
    notify: jest.fn().mockResolvedValue(undefined),
    notifyMany: jest.fn().mockResolvedValue(undefined),
  };
  const mailer = { isConfigured: jest.fn().mockResolvedValue(false), sendMail: jest.fn() };
  // The Email Configuration matrix: a tenant on the seeded defaults.
  const notificationRules = {
    forEvent: jest.fn().mockImplementation(async (_c: string, event: string) => DEFAULT_RULES.filter((r) => r.event === event)),
  };

  const service = new TicketsService(
    prisma as unknown as PrismaService,
    {} as TemplatesService,
    activity as unknown as ActivityService,
    mailer as unknown as MailerService,
    {} as ProductsService,
    notifications as unknown as NotificationsService,
    {} as CustomerProductsService,
    notificationRules as unknown as NotificationRulesService,
  );
  return { service, prisma, activity, notifications, mailer, notificationRules };
}

/** Who got a bell of this type (`fireEvent` bells one person at a time). */
function belled(notifications: ReturnType<typeof build>['notifications'], type: string) {
  return notifications.notify.mock.calls
    .map((c) => c[0] as { userId: string; type: string; title: string; body: string })
    .filter((n) => n.type === type);
}
const belledIds = (notifications: ReturnType<typeof build>['notifications'], type: string) =>
  belled(notifications, type).map((n) => n.userId);

// The company's own admin — allowed to acknowledge any of their company's tickets.
const contact: TicketViewer = { id: 'contact-1', roles: ['CustomerAdmin'], customerCompanyId: COMPANY_ID };
// Every reopen carries a reason; the agents are notified with it.
const REASON = 'The printer went offline again the next morning';
const admin: TicketViewer = { id: 'admin-1', roles: ['Admin'] };
// The client product's project manager: a member of staff, not on the ticket.
const pm: TicketViewer = { id: 'pm-1', roles: ['Viewer'] };
const consultant: TicketViewer = { id: 'agent-1', roles: ['Viewer'] };
/** A closed ticket whose client asked to reopen it, put to pm-1. */
const pendingRequest = (overrides: TicketRow = {}) =>
  ticketRow({
    ticketStatus: 'Closed',
    reopenRequestStatus: 'PENDING',
    reopenRequestReason: REASON,
    reopenRequestedById: 'contact-1',
    reopenApproverUserId: 'pm-1',
    ...overrides,
  });

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
    expect(belledIds(notifications, 'TICKET_ACKNOWLEDGED')).toContain('agent-1');
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

  it('clears the sign-off on an approved reopen so the next resolution can be acknowledged', async () => {
    const { service, prisma } = build(pendingRequest());

    await service.approveReopenRequest('ticket-1', CLIENT_ID, admin.id, admin);

    const data = prisma.ticket.update.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.acknowledgedAt).toBeNull();
    expect(data.acknowledgedById).toBeNull();
  });
});

describe('TicketsService — reopen window', () => {
  const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

  it('accepts a request on a ticket resolved inside the tenant window', async () => {
    const { service, prisma } = build(ticketRow({ resolvedAt: daysAgo(29) }));

    await service.requestReopen('ticket-1', CLIENT_ID, { reason: REASON }, 'contact-1', contact);

    expect(prisma.ticket.update).toHaveBeenCalled();
  });

  it('refuses a request once the window has closed, pointing at a new ticket', async () => {
    const { service, prisma } = build(ticketRow({ resolvedAt: daysAgo(31) }));

    await expect(service.requestReopen('ticket-1', CLIENT_ID, { reason: REASON }, 'contact-1', contact)).rejects.toThrow(
      /30 days ago and can no longer be reopened/,
    );
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  it('honours a tenant that widened the window', async () => {
    const { service, prisma } = build(ticketRow({ resolvedAt: daysAgo(31) }), STATUS_OPTIONS, 2.5, 90);

    await service.requestReopen('ticket-1', CLIENT_ID, { reason: REASON }, 'contact-1', contact);

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

describe('TicketsService — a reopen request', () => {
  it('refuses a request with no reason', async () => {
    const { service, prisma } = build(ticketRow());

    await expect(
      service.requestReopen('ticket-1', CLIENT_ID, { reason: '   ' }, 'contact-1', contact),
    ).rejects.toThrow(/why this ticket needs to be reopened/);
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  it('records the request and leaves the ticket closed', async () => {
    const { service, prisma, activity } = build(ticketRow({ ticketStatus: 'Closed' }));

    await service.requestReopen('ticket-1', CLIENT_ID, { reason: `  ${REASON}  ` }, 'contact-1', contact);

    const data = prisma.ticket.update.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.reopenRequestStatus).toBe('PENDING');
    expect(data.reopenRequestReason).toBe(REASON); // trimmed
    expect(data.reopenRequestedById).toBe('contact-1');
    // Nothing about the ticket itself moves until someone approves.
    expect(data).not.toHaveProperty('ticketStatus');
    expect(data).not.toHaveProperty('resolvedAt');
    expect(activity.log).toHaveBeenCalledWith(expect.objectContaining({ type: 'REOPEN_REQUESTED' }));
  });

  it('puts it to the client product project manager, and to nobody else', async () => {
    const { service, prisma, notifications } = build(ticketRow({ productId: 'product-1' }));
    prisma.customerCompanyProduct.findFirst.mockResolvedValue({
      productManager: { id: 'pm-1', isActive: true, clientId: CLIENT_ID, customerCompanyId: null },
    });

    await service.requestReopen('ticket-1', CLIENT_ID, { reason: REASON }, 'contact-1', contact);

    const data = prisma.ticket.update.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.reopenApproverUserId).toBe('pm-1');
    expect(notifications.notifyMany).toHaveBeenCalledWith(
      ['pm-1'],
      expect.objectContaining({ type: 'TICKET_REOPEN_REQUESTED', ticketId: 'ticket-1' }),
    );
  });

  it('falls back to the tenant Admins when no project manager is set', async () => {
    const { service, prisma, notifications } = build(ticketRow({ productId: 'product-1' }));

    await service.requestReopen('ticket-1', CLIENT_ID, { reason: REASON }, 'contact-1', contact);

    const data = prisma.ticket.update.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.reopenApproverUserId).toBeNull();
    expect(notifications.notifyMany).toHaveBeenCalledWith(
      ['company-admin-1'],
      expect.objectContaining({ type: 'TICKET_REOPEN_REQUESTED' }),
    );
  });

  it('skips a project manager who has been deactivated', async () => {
    const { service, prisma } = build(ticketRow({ productId: 'product-1' }));
    prisma.customerCompanyProduct.findFirst.mockResolvedValue({
      productManager: { id: 'pm-1', isActive: false, clientId: CLIENT_ID, customerCompanyId: null },
    });

    await service.requestReopen('ticket-1', CLIENT_ID, { reason: REASON }, 'contact-1', contact);

    const data = prisma.ticket.update.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.reopenApproverUserId).toBeNull();
  });

  it('refuses a second request while one is waiting', async () => {
    const { service, prisma } = build(pendingRequest());

    await expect(service.requestReopen('ticket-1', CLIENT_ID, { reason: REASON }, 'contact-1', contact)).rejects.toThrow(
      /already waiting/,
    );
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  it('refuses a ticket that was never resolved', async () => {
    const { service, prisma } = build(ticketRow({ ticketStatus: 'Open', resolvedAt: null }));

    await expect(service.requestReopen('ticket-1', CLIENT_ID, { reason: REASON }, 'contact-1', contact)).rejects.toThrow(
      /Only a resolved or closed ticket/,
    );
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  it('lets the client withdraw it, leaving the ticket closed', async () => {
    const { service, prisma } = build(pendingRequest());

    await service.withdrawReopenRequest('ticket-1', CLIENT_ID, 'contact-1', contact);

    const data = prisma.ticket.update.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.reopenRequestStatus).toBe('WITHDRAWN');
    expect(data).not.toHaveProperty('ticketStatus');
  });
});

describe('TicketsService — deciding a reopen request', () => {
  it('reopens the ticket when its project manager approves, in the name of the client who asked', async () => {
    const { service, prisma, activity } = build(pendingRequest());

    await service.approveReopenRequest('ticket-1', CLIENT_ID, pm.id, pm);

    const data = prisma.ticket.update.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.reopenRequestStatus).toBe('APPROVED');
    expect(data.reopenDecidedById).toBe('pm-1');
    expect(data.ticketStatus).toBe('Reopened');
    expect(data.resolvedAt).toBeNull();
    expect(data.reopenReason).toBe(REASON);
    expect(data.reopenedById).toBe('contact-1');
    const types = activity.log.mock.calls.map((c) => (c[0] as { type: string }).type);
    expect(types).toEqual(['REOPEN_APPROVED', 'REOPENED']);
  });

  it('lets any tenant Admin decide it too', async () => {
    const { service, prisma } = build(pendingRequest());

    await service.approveReopenRequest('ticket-1', CLIENT_ID, admin.id, admin);

    expect(prisma.ticket.update).toHaveBeenCalled();
  });

  it('refuses another agent, even one assigned to the ticket', async () => {
    const { service, prisma } = build(pendingRequest({ technicians: [{ user: { id: 'agent-1' } }] }));

    await expect(service.approveReopenRequest('ticket-1', CLIENT_ID, consultant.id, consultant)).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  it('keeps the ticket closed on a rejection, which needs a reason', async () => {
    const { service, prisma, notifications } = build(pendingRequest());

    await expect(
      service.rejectReopenRequest('ticket-1', CLIENT_ID, { reason: ' ' }, pm.id, pm),
    ).rejects.toThrow(/Say why/);

    await service.rejectReopenRequest('ticket-1', CLIENT_ID, { reason: 'A different fault' }, pm.id, pm);

    const data = prisma.ticket.update.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.reopenRequestStatus).toBe('REJECTED');
    expect(data.reopenDecisionNote).toBe('A different fault');
    expect(data).not.toHaveProperty('ticketStatus');
    // The client who asked hears why.
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'contact-1', type: 'TICKET_REOPEN_REJECTED' }),
    );
  });

  it('refuses to decide a request that is no longer waiting', async () => {
    const { service, prisma } = build(pendingRequest({ reopenRequestStatus: 'WITHDRAWN' }));

    await expect(service.approveReopenRequest('ticket-1', CLIENT_ID, admin.id, admin)).rejects.toThrow(
      /no reopen request waiting/,
    );
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });
});

describe('TicketsService — only the client may ask to reopen', () => {
  it('lets a customer employee ask to reopen their own ticket', async () => {
    const { service, prisma } = build(ticketRow());
    const employee: TicketViewer = { id: 'contact-1', roles: ['Customer'], customerCompanyId: COMPANY_ID };

    await service.requestReopen('ticket-1', CLIENT_ID, { reason: REASON }, employee.id, employee);

    expect(prisma.ticket.update).toHaveBeenCalled();
  });

  it('never reopens a client ticket directly, even for the client', async () => {
    const { service, prisma } = build(ticketRow());

    await expect(service.reopen('ticket-1', CLIENT_ID, { reason: REASON }, contact.id, contact)).rejects.toThrow(
      /Send a reopen request instead/,
    );
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  it('refuses a provider admin reopening on the client behalf', async () => {
    const { service, prisma } = build(ticketRow());

    await expect(service.reopen('ticket-1', CLIENT_ID, { reason: REASON }, admin.id, admin)).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service.requestReopen('ticket-1', CLIENT_ID, { reason: REASON }, admin.id, admin)).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  it('still lets staff reopen an internal ticket directly, which has no client to ask', async () => {
    const { service, prisma, notifications } = build(ticketRow({ customerCompanyId: null }));

    await service.reopen('ticket-1', CLIENT_ID, { reason: REASON }, admin.id, admin);

    const data = prisma.ticket.update.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.reopenReason).toBe(REASON);
    expect(data.reopenedById).toBe(admin.id);
    // The agents are told it is back, with the reason — but never the one who did it.
    const bells = belled(notifications, 'TICKET_REOPENED');
    expect(bells.map((b) => b.userId)).toContain('agent-1');
    expect(bells.map((b) => b.userId)).not.toContain(admin.id);
    expect(bells[0].body).toContain(REASON);
  });

  it('refuses an agent reopening an internal ticket directly — an Admin must approve', async () => {
    const { service, prisma } = build(ticketRow({ customerCompanyId: null, technicians: [{ user: { id: 'agent-1' } }] }));

    await expect(service.reopen('ticket-1', CLIENT_ID, { reason: REASON }, consultant.id, consultant)).rejects.toThrow(
      /an Admin approves it/,
    );
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  it('lets an agent ask to reopen an internal ticket, for the Admins to decide', async () => {
    const { service, prisma } = build(ticketRow({ customerCompanyId: null, technicians: [{ user: { id: 'agent-1' } }] }));

    await service.requestReopen('ticket-1', CLIENT_ID, { reason: REASON }, consultant.id, consultant);

    const data = prisma.ticket.update.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.reopenRequestStatus).toBe('PENDING');
    expect(data.reopenRequestedById).toBe(consultant.id);
    // No client product, so no project manager: the Admins decide.
    expect(data.reopenApproverUserId).toBeNull();
    // The ticket itself is not reopened by asking.
    expect(data.resolvedAt).toBeUndefined();
  });

  it('tells an Admin to reopen an internal ticket directly rather than ask', async () => {
    const { service, prisma } = build(ticketRow({ customerCompanyId: null }));

    await expect(service.requestReopen('ticket-1', CLIENT_ID, { reason: REASON }, admin.id, admin)).rejects.toThrow(
      /reopen this ticket directly/,
    );
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  it('refuses a consultant reopening a ticket they worked', async () => {
    // Assigned to them, so findOne lets them through — the reopen rule is what stops them.
    const { service, prisma } = build(ticketRow({ technicians: [{ user: { id: 'agent-1' } }] }));

    await expect(service.reopen('ticket-1', CLIENT_ID, { reason: REASON }, consultant.id, consultant)).rejects.toThrow(
      /Only the client can ask to reopen their own ticket/,
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
    expect(belledIds(notifications, 'TICKET_RESOLVED')).toEqual(expect.arrayContaining(['contact-1', 'company-admin-1']));
  });

  it('does not re-notify when an already-resolved ticket changes status again', async () => {
    const { service, notifications } = build(ticketRow({ ticketStatus: 'Resolved' }));

    await service.update('ticket-1', CLIENT_ID, { ticketStatus: 'Open' }, agent.id, agent);

    expect(belled(notifications, 'TICKET_RESOLVED')).toEqual([]);
  });

  it('does not re-notify when the resolution notes are edited', async () => {
    const { service, notifications } = build(ticketRow());

    await service.setResolution('ticket-1', CLIENT_ID, { resolution: 'Updated note' }, agent.id, agent);

    expect(belled(notifications, 'TICKET_RESOLVED')).toEqual([]);
  });

  it('notifies on the first resolution saved from the Resolution tab', async () => {
    const { service, notifications } = build(
      ticketRow({ ticketStatus: 'Open', resolvedAt: null, resolvedById: null }),
    );

    await service.setResolution('ticket-1', CLIENT_ID, { resolution: 'Fixed' }, agent.id, agent);

    expect(belledIds(notifications, 'TICKET_RESOLVED')).toContain('contact-1');
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
    expect(belledIds(notifications, 'TICKET_CLOSED')).toEqual(expect.arrayContaining(['contact-1', 'agent-1']));
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
    // A ticket naming no product may be assigned to any staff member: the
    // assignable-agents gate reads all staff first (only when assigning someone).
    if (incoming.length) prisma.user.findMany.mockResolvedValueOnce([...previous, ...incoming]);
    prisma.user.findMany
      // the incoming agents, for the activity summary
      .mockResolvedValueOnce(incoming)
      // then the CustomerAdmins, then the tenant Admins
      .mockResolvedValueOnce([{ id: 'company-admin-1', email: 'ada@acme.test' }])
      // admin-1 is also the actor; admin-2 is the other tenant Admin.
      .mockResolvedValueOnce([
        { id: 'admin-1', email: 'pm@provider.test' },
        { id: 'admin-2', email: 'lead@provider.test' },
      ]);
  }

  it("refuses a Products-screen agent who is not one of the client's people", async () => {
    const { service, prisma } = build({ ...openTicket(), productId: 'product-1', moduleId: 'module-mm' });
    prisma.ticketTechnician.findMany.mockResolvedValue([]);
    prisma.user.count.mockResolvedValue(1);
    // agent-2 is on MM's list on the Products screen — that no longer counts for
    // a client's ticket; the client's own consultant is agent-1 only.
    prisma.moduleConsultant.findMany.mockResolvedValue([{ userId: 'agent-2' }]);
    prisma.customerConsultant.findMany.mockResolvedValue([
      { userId: 'agent-1', productId: 'product-1', moduleId: 'module-mm', isPrimary: true },
    ]);
    prisma.user.findMany
      .mockResolvedValueOnce([{ id: 'agent-1', username: 'agent1', name: 'Ada One' }]) // the assignable list
      .mockResolvedValueOnce([{ username: 'agent2', name: 'Bo Two' }]); // who was refused, for the message

    await expect(
      service.assignTechnicians('ticket-1', CLIENT_ID, ['agent-2'], admin.id, admin),
    ).rejects.toThrow("Bo Two is not one of this client's consultants");
    expect(prisma.ticketTechnician.createMany).not.toHaveBeenCalled();
  });

  const AGENT_1 = { id: 'agent-1', username: 'agent1', email: 'a1@provider.test' };
  const AGENT_2 = { id: 'agent-2', username: 'agent2', email: 'a2@provider.test' };

  it('tells the incoming agent, the outgoing agent and everyone watching', async () => {
    const { service, prisma, notifications } = build(openTicket());
    wireAssignment(prisma, [AGENT_1], [AGENT_2]);

    await service.assignTechnicians('ticket-1', CLIENT_ID, ['agent-2'], admin.id, admin);

    // The agent who now owns it.
    expect(belledIds(notifications, 'TICKET_ASSIGNED')).toEqual(['agent-2']);
    // The agent it left.
    expect(belledIds(notifications, 'TICKET_UNASSIGNED')).toEqual(['agent-1']);
    // The requestor, the client's own admin and the other tenant Admin.
    const watchers = belled(notifications, 'TICKET_REASSIGNED');
    expect(watchers.map((w) => w.userId)).toEqual(expect.arrayContaining(['contact-1', 'company-admin-1', 'admin-2']));
    expect(watchers[0].body).toMatch(/has moved from agent1 to agent2/);
  });

  it('never pings the person who performed the change', async () => {
    const { service, prisma, notifications } = build(openTicket());
    wireAssignment(prisma, [AGENT_1], [AGENT_2]);

    await service.assignTechnicians('ticket-1', CLIENT_ID, ['agent-2'], admin.id, admin);

    // admin-1 is a tenant Admin *and* the actor.
    const told = notifications.notify.mock.calls.map((c) => (c[0] as { userId: string }).userId);
    expect(told).not.toContain('admin-1');
    expect(told).toContain('admin-2');
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

    // 2. Assigned to the agent, 4. Accepted to the client — never a "handover".
    expect(belledIds(notifications, 'TICKET_ASSIGNED')).toContain('agent-1');
    const accepted = belled(notifications, 'TICKET_ACCEPTED');
    expect(accepted.map((a) => a.userId)).toContain('contact-1');
    expect(accepted[0].body).toMatch(/has been assigned to agent1/);
    expect(belled(notifications, 'TICKET_REASSIGNED')).toEqual([]);
  });

  it('reads an empty assignment as an unassignment', async () => {
    const { service, prisma, notifications } = build(openTicket());
    wireAssignment(prisma, [AGENT_1], []);

    await service.assignTechnicians('ticket-1', CLIENT_ID, [], admin.id, admin);

    expect(belledIds(notifications, 'TICKET_UNASSIGNED')).toEqual(['agent-1']);
    expect(belled(notifications, 'TICKET_REASSIGNED')[0].title).toBe('Ticket unassigned');
  });

  it('still completes the assignment when SMTP is down', async () => {
    const { service, prisma, mailer } = build(openTicket());
    wireAssignment(prisma, [AGENT_1], [AGENT_2]);
    mailer.isConfigured.mockResolvedValue(false);

    await expect(
      service.assignTechnicians('ticket-1', CLIENT_ID, ['agent-2'], admin.id, admin),
    ).resolves.toBeDefined();
    await service.flushMail();
    expect(mailer.sendMail).not.toHaveBeenCalled();
  });

  it('returns before the email is sent, then sends it', async () => {
    const { service, prisma, mailer } = build(openTicket());
    wireAssignment(prisma, [AGENT_1], [AGENT_2]);
    mailer.isConfigured.mockResolvedValue(true);
    let release!: () => void;
    // A slow mail server: the first send hangs until released.
    mailer.sendMail
      .mockImplementationOnce(() => new Promise((r) => { release = () => r({}); }))
      .mockResolvedValue({});

    await service.assignTechnicians('ticket-1', CLIENT_ID, ['agent-2'], admin.id, admin);
    // The assignment came back while the first email was still in flight.
    expect(mailer.sendMail).toHaveBeenCalledTimes(1);
    release();
    await service.flushMail();
    // Requestor, client admin, incoming agent, the other tenant Admin.
    expect(mailer.sendMail).toHaveBeenCalledTimes(4);
  });

  it('logs a failed email and keeps sending the next one', async () => {
    const { service, prisma, mailer } = build(openTicket());
    wireAssignment(prisma, [AGENT_1], [AGENT_2]);
    mailer.isConfigured.mockResolvedValue(true);
    mailer.sendMail.mockRejectedValueOnce(new Error('SMTP down')).mockResolvedValue({});

    await service.assignTechnicians('ticket-1', CLIENT_ID, ['agent-2'], admin.id, admin);
    await service.flushMail();
    expect(mailer.sendMail).toHaveBeenCalledTimes(4);
  });

  it('emails each person separately, as the Email Configuration says', async () => {
    const { service, prisma, mailer } = build(openTicket());
    wireAssignment(prisma, [AGENT_1], [AGENT_2]);
    mailer.isConfigured.mockResolvedValue(true);
    mailer.sendMail.mockResolvedValue({});

    await service.assignTechnicians('ticket-1', CLIENT_ID, ['agent-2'], admin.id, admin);
    // Emails are queued and sent after the call returns; nothing goes out before.
    await service.flushMail();

    const sent = mailer.sendMail.mock.calls.map((c) => c[0] as { to: string; subject: string });
    expect(sent.map((m) => m.to)).toEqual([
      // One email per person, client side first.
      'contact@acme.test',
      'ada@acme.test',
      // The incoming agent gets the team lead's "Ticket Reassigned" email…
      'a2@provider.test',
      // …and the other Admin the admins' one (the acting Admin is never mailed).
      'lead@provider.test',
    ]);
    expect(sent[2].subject).toBe('[Ticket Reassigned] – T-000001 assigned to you');
    expect(sent[3].subject).toBe('[Ticket Reassigned] - T-000001 assigned to agent2');
  });
});

describe('TicketsService — a Closed ticket\'s status is frozen until a reopen', () => {
  const agent: TicketViewer = { id: 'agent-1', roles: ['Admin'] };
  const closed = (o: TicketRow = {}) =>
    ticketRow({ ticketStatus: 'Closed', closedDate: new Date('2026-11-10T10:00:00Z'), acknowledgedAt: new Date('2026-11-10T10:00:00Z'), ...o });

  it('refuses moving a closed client ticket back to an open status', async () => {
    const { service, prisma } = build(closed());

    await expect(
      service.update('ticket-1', CLIENT_ID, { ticketStatus: 'In Progress' }, agent.id, agent),
    ).rejects.toThrow(/reopen request from the client/);
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  it('refuses it on an internal ticket too, pointing at Reopen', async () => {
    const { service, prisma } = build(closed({ customerCompanyId: null }));

    await expect(
      service.update('ticket-1', CLIENT_ID, { ticketStatus: 'Open' }, agent.id, agent),
    ).rejects.toThrow(/use Reopen/);
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  it('refuses the resolution endpoint, which would pull it back to Resolved', async () => {
    const { service, prisma } = build(closed());

    await expect(
      service.setResolution('ticket-1', CLIENT_ID, { resolution: 'Edited' }, agent.id, agent),
    ).rejects.toThrow(/ticket is closed/);
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  it('still saves other fields on a closed ticket when the status is not changing', async () => {
    const { service, prisma } = build(closed());

    await service.update('ticket-1', CLIENT_ID, { ticketStatus: 'Closed', ticketCategory: 'Hardware' }, agent.id, agent);

    expect(prisma.ticket.update).toHaveBeenCalled();
  });

  it('holds again after a reopen → resolve → close round (read off the live status)', async () => {
    const { service, prisma } = build(closed({ reopenedCount: 2, reopenedAt: new Date('2026-11-09T10:00:00Z') }));

    await expect(
      service.update('ticket-1', CLIENT_ID, { ticketStatus: 'In Progress' }, agent.id, agent),
    ).rejects.toThrow(/ticket is closed/);
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });
});

describe('TicketsService — a Critical ticket\'s emails are CC\'d to the critical ticket admin', () => {
  // The critical ticket admin gets a copy of the ticket email itself — there is
  // no separate alert email any more (team lead's request).
  type Mailing = {
    mailEach(
      clientId: string, ticket: { id: string; ticketNumber: string; subject: string },
      recipients: { email: string | null; name?: string | null }[], subject: string,
      content: { intro: string; fields: string[] }, context: string,
    ): Promise<void>;
  };
  const send = async (org: { criticalTicketAlerts: boolean; criticalTicketEmail: string | null }, priorityLabel: string) => {
    const { service, prisma, mailer } = build(ticketRow());
    // One client row serves both the email's facts and its CC line.
    (prisma.client.findUnique as jest.Mock).mockResolvedValue({ name: 'Acme', dateFormat: 'dd/MM/yyyy', helpdeskEmail: null, ...org });
    (prisma.ticket as unknown as { findUnique: jest.Mock }).findUnique = jest.fn().mockResolvedValue({
      ticketNumber: 'T-000009', subject: 'Payroll down', description: 'Payroll run fails', priority: 'P1', ticketStatus: 'Open',
      createdAt: new Date('2026-11-28T09:00:00Z'), technicians: [], customerCompany: { name: 'Globex' },
    });
    (prisma.picklistOption.findMany as jest.Mock).mockResolvedValue([{ listKey: 'priority', value: 'P1', label: priorityLabel }]);
    mailer.isConfigured.mockResolvedValue(true);
    mailer.sendMail.mockResolvedValue({});
    await (service as unknown as Mailing).mailEach(
      CLIENT_ID, { id: 'ticket-1', ticketNumber: 'T-000009', subject: 'Payroll down' },
      [{ email: 'raiser@globex.test', name: 'Ria' }, { email: 'boss@globex.test', name: 'Bo' }],
      'T-000009 - Created', { intro: 'Registered.', fields: ['number', 'subject', 'priority'] }, 'test',
    );
    await service.flushMail();
    return mailer.sendMail.mock.calls.map((c) => c[0] as { to: string; cc?: string; html: string });
  };

  it('CCs the critical ticket admin on a Critical ticket\'s email, once per event, and sends nothing else', async () => {
    const sent = await send({ criticalTicketAlerts: true, criticalTicketEmail: 'lead@acme.test' }, 'Critical');
    expect(sent.map((m) => m.to)).toEqual(['raiser@globex.test', 'boss@globex.test']);
    expect(sent[0].cc).toBe('lead@acme.test');
    expect(sent[1].cc).toBeUndefined();
    expect(sent[0].html).toContain('Ticket Details');
  });

  it('adds no CC while the switch is off', async () => {
    const sent = await send({ criticalTicketAlerts: false, criticalTicketEmail: 'lead@acme.test' }, 'Critical');
    expect(sent.every((m) => !m.cc)).toBe(true);
  });

  it('adds no CC for a ticket that is not Critical', async () => {
    const sent = await send({ criticalTicketAlerts: true, criticalTicketEmail: 'lead@acme.test' }, 'High');
    expect(sent.every((m) => !m.cc)).toBe(true);
  });
});
