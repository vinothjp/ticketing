import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TemplatesService } from '../templates/templates.service';
import { ActivityService } from '../activity/activity.service';
import { MailerService } from '../mail/mailer.service';
import { ProductsService } from '../products/products.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CustomerProductsService } from '../customer-companies/customer-products.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { CreateWorklogDto } from './dto/worklog.dto';
import { SETTLED_TASK_STATUSES } from '../tasks/task-status';

const FIELD_KEY_TO_DTO_PROP: Record<string, keyof CreateTicketDto> = {
  requestorName: 'requestorName',
  customerName: 'customerName',
  department: 'department',
  requestorContact: 'requestorContact',
  priority: 'priority',
  ticketCategory: 'ticketCategory',
  subCategory: 'subCategory',
  technicians: 'technicianUserIds',
  notifyEmails: 'notifyEmails',
  dueDate: 'dueDate',
  expectedResolutionDate: 'expectedResolutionDate',
  subject: 'subject',
  description: 'description',
};

const DAY_MS = 24 * 60 * 60 * 1000;
/** Fallback reopen window for a tenant whose row predates the setting. */
const DEFAULT_REOPEN_WINDOW_DAYS = 30;
/** Fallback auto-close window for a tenant whose row predates the setting. */
const DEFAULT_AUTO_CLOSE_DAYS = 3;

function isEmpty(value: unknown) {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  );
}

/** The authenticated user viewing/acting on tickets. Admins see all; others only their assigned tickets. */
export type TicketViewer = { id: string; roles: string[]; customerCompanyId?: string | null };
/** The coordinates a worklog's hours are charged against: the ticket's customer + product. */
type WorklogTicket = { id: string; customerCompanyId: string | null; productId: string | null };
/** An agent on either side of a reassignment. */
type Agent = { id: string; username: string; email: string | null };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Usable, de-duped addresses as one `To:` header — empty string when there are none. */
function joinEmails(addresses: (string | null | undefined)[]): string {
  return [...new Set(addresses.filter((a): a is string => !!a && EMAIL_RE.test(a)))].join(', ');
}

/** House-style email body: 480px wrapper, coloured header bar, white card. */
function reassignmentHtml(heading: string, greetName: string | null, bodyHtml: string): string {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto;">
      <div style="background:#4F46E5; padding:24px; border-radius:12px 12px 0 0; text-align:center;">
        <h1 style="color:#fff; margin:0; font-size:18px;">${heading}</h1>
      </div>
      <div style="background:#fff; padding:28px; border:1px solid #e5e7eb; border-top:none; border-radius:0 0 12px 12px;">
        ${greetName !== null ? `<p style="color:#374151; font-size:14px;">Hi ${greetName ?? 'there'},</p>` : ''}
        <p style="color:#374151; font-size:14px;">${bodyHtml}</p>
        <p style="color:#6b7280; font-size:12px; margin-top:20px;">Sign in to view the ticket and its latest updates.</p>
      </div>
    </div>`;
}
const isAdmin = (viewer: TicketViewer) => viewer.roles.includes('Admin');
// Customer side = a company's own admin + its employees.
const isCustomerAdmin = (viewer: TicketViewer) => viewer.roles.includes('CustomerAdmin');
const isCustomerSide = (viewer: TicketViewer) =>
  viewer.roles.includes('Customer') || viewer.roles.includes('CustomerAdmin');
// An employee is a customer-side user who is NOT their company's admin.
const isCustomerEmployee = (viewer: TicketViewer) => isCustomerSide(viewer) && !isCustomerAdmin(viewer);

@Injectable()
export class TicketsService {
  private readonly logger = new Logger(TicketsService.name);

  constructor(
    private prisma: PrismaService,
    private templatesService: TemplatesService,
    private activity: ActivityService,
    private mailer: MailerService,
    private products: ProductsService,
    private notifications: NotificationsService,
    private customerProducts: CustomerProductsService,
  ) {}

  async create(dto: CreateTicketDto, clientId: string, actorId: string, viewer?: TicketViewer) {
    // No approval gate — a customer ticket becomes active immediately and is
    // auto-routed to a consultant. A customer can only raise a ticket under their
    // own company and can't self-assign technicians (forced server-side).
    const isCustomerTicket = viewer ? isCustomerSide(viewer) : false;
    let requestorDefaults: { name?: string; email?: string; companyId?: string } = {};
    if (viewer && isCustomerSide(viewer)) {
      // A customer must belong to a company; otherwise the ticket would be
      // orphaned (no company) and invisible even to its own creator.
      if (!viewer.customerCompanyId) {
        throw new BadRequestException('Your account is not linked to a customer company');
      }
      const me = await this.prisma.user.findUnique({
        where: { id: viewer.id },
        select: { username: true, email: true },
      });
      dto = {
        ...dto,
        customerCompanyId: viewer.customerCompanyId ?? undefined,
        technicianUserIds: [],
        requestorUserId: viewer.id,
      } as CreateTicketDto & { requestorUserId?: string };
      requestorDefaults = { name: me?.username, email: me?.email, companyId: viewer.customerCompanyId ?? undefined };
      // A client whose support hours are spent may be barred from raising more
      // tickets — configured per pool on the client screen. Staff-raised tickets
      // are never gated.
      await this.customerProducts.assertMayRaiseTicket(
        clientId, viewer.customerCompanyId, dto.productId ?? null,
      );
    }
    const template = await this.templatesService.getById(
      dto.templateId,
      clientId,
    );

    // Server-side is the source of truth for "required" — it's tenant-configured
    // data, so the client's zod validation alone can't be trusted. We also
    // collect custom-field values into the JSONB bag here.
    const missing: string[] = [];
    const customFields: Record<string, unknown> = {};
    for (const field of template.fields) {
      if (field.visibility !== 'VISIBLE') continue;

      // Custom fields and JSON-backed catalog fields (request type, customer
      // confirmation, root cause) persist into the customFields JSONB bag.
      const jsonBacked = field.isCustom || field.storage === 'json';
      if (jsonBacked) {
        const value = dto.customFields?.[field.fieldKey];
        if (
          field.requirement === 'MANDATORY' &&
          !field.systemManaged &&
          isEmpty(value)
        ) {
          missing.push(field.label);
        }
        // FILE fields aren't persisted in JSONB (no per-field upload yet).
        if (!isEmpty(value) && field.dataType !== 'FILE') {
          customFields[field.fieldKey] = value;
        }
        continue;
      }

      if (field.systemManaged || field.requirement !== 'MANDATORY') continue;
      const dtoProp = FIELD_KEY_TO_DTO_PROP[field.fieldKey];
      if (!dtoProp) continue; // e.g. attachments — enforced client-side only for now
      if (isEmpty(dto[dtoProp])) missing.push(field.label);
    }
    if (missing.length > 0) {
      throw new BadRequestException(
        `Missing required field(s): ${missing.join(', ')}`,
      );
    }

    const defaultStatusOption = await this.prisma.picklistOption.findFirst({
      where: { clientId, listKey: 'ticketStatus', isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    const ticketStatus = defaultStatusOption?.value ?? 'New';

    // SLA: auto-fill resolution target + Due Date from the SLA policy for this priority.
    let slaHours: number | undefined;
    let slaDue: Date | undefined;
    if (dto.priority) {
      const sla = await this.prisma.slaPolicy.findFirst({
        where: { clientId, priority: dto.priority, isActive: true },
      });
      if (sla) {
        slaHours = sla.resolutionHours;
        slaDue = new Date(Date.now() + sla.resolutionHours * 3600 * 1000);
      }
    }

    const ticket = await this.prisma.$transaction(async (tx) => {
      const client = await tx.client.update({
        where: { id: clientId },
        data: { ticketSequence: { increment: 1 } },
      });
      const ticketNumber = `TCK-${String(client.ticketSequence).padStart(6, '0')}`;

      return tx.ticket.create({
        data: {
          clientId,
          ticketNumber,
          templateId: template.id,
          ticketStatus,
          // Seeded on creation so a brand-new ticket already reports how long it
          // has stood in its opening status, rather than nothing until someone
          // touches it.
          statusChangedAt: new Date(),
          approvalStatus: 'NONE',
          productId: dto.productId,
          moduleId: dto.moduleId,
          consultantType: dto.consultantType,
          requestorName: dto.requestorName ?? requestorDefaults.name,
          requestorEmail: dto.requestorEmail ?? requestorDefaults.email,
          requestorUserId: (dto as { requestorUserId?: string }).requestorUserId,
          customerName: dto.customerName,
          customerCompanyId: dto.customerCompanyId,
          department: dto.department,
          requestorContact: dto.requestorContact,
          priority: dto.priority,
          ticketCategory: dto.ticketCategory,
          subCategory: dto.subCategory,
          notifyEmails: dto.notifyEmails ?? [],
          dueDate: dto.dueDate ? new Date(dto.dueDate) : slaDue,
          expectedResolutionDate: dto.expectedResolutionDate
            ? new Date(dto.expectedResolutionDate)
            : slaDue,
          slaHours,
          subject: dto.subject ?? '',
          description: dto.description ?? '',
          customFields: customFields as Prisma.InputJsonValue,
          createdBy: actorId,
          updatedBy: actorId,
          technicians: dto.technicianUserIds?.length
            ? { create: dto.technicianUserIds.map((userId) => ({ userId })) }
            : undefined,
        },
        include: { technicians: true, template: true },
      });
    });

    await this.activity.log({
      ticketId: ticket.id,
      actorUserId: actorId,
      type: 'CREATED',
      summary: 'Ticket created',
    });

    // Auto-route a customer ticket to the consultant configured for it. The tiers
    // are tried most-specific-first and a tier is skipped ONLY when it holds no
    // consultant for this product/module/track — never because the consultant is
    // busy. The same product+module always routes to the same person, however
    // many open tickets they already hold. "Others"/no module stays unassigned
    // for an admin to pick.
    let assignedConsultantId: string | null = null;
    if (isCustomerTicket) {
      const track = dto.consultantType === 'TECHNICAL' ? 'TECHNICAL' : dto.consultantType === 'FUNCTIONAL' ? 'FUNCTIONAL' : null;
      // 1) & 2) The customer's own consultants — product-scoped first, then their
      //    default set — override the product's routing.
      assignedConsultantId = await this.customerProducts.resolveCustomerConsultant(
        clientId, ticket.customerCompanyId, dto.productId ?? null, dto.moduleId ?? null, track,
      );
      // 3) Otherwise fall back to the consultants set on the Product screen —
      //    the module's list first, then the product-level list for an unsplit
      //    product. A ticket only stays unassigned when the named product has no
      //    consultants at all (e.g. "Others"), and an admin picks someone.
      if (!assignedConsultantId && dto.productId) {
        if (dto.moduleId) {
          assignedConsultantId = await this.products.resolveConsultant(clientId, dto.moduleId, track);
        }
        assignedConsultantId ??= await this.products.resolveProductConsultant(clientId, dto.productId, track);
      }
      if (assignedConsultantId) {
        await this.prisma.ticketTechnician.create({ data: { ticketId: ticket.id, userId: assignedConsultantId } });
        const c = await this.prisma.user.findUnique({ where: { id: assignedConsultantId }, select: { username: true } });
        await this.activity.log({
          ticketId: ticket.id,
          actorUserId: actorId,
          type: 'ASSIGNED',
          summary: `Auto-assigned to ${c?.username ?? 'consultant'}`,
          meta: { userId: assignedConsultantId, auto: true },
        });
      }
    }

    // In-app notifications for a customer-created ticket: acknowledge the creator,
    // alert every provider admin, and alert the assigned consultant.
    if (isCustomerTicket && viewer) {
      await this.emitTicketNotifications({
        clientId,
        ticketId: ticket.id,
        ticketNumber: ticket.ticketNumber,
        subject: ticket.subject,
        creatorUserId: viewer.id,
        assignedConsultantId,
      });
    }

    return this.prisma.ticket.findUnique({ where: { id: ticket.id }, include: { technicians: { include: { user: { select: { id: true, username: true } } } }, template: true } });
  }

  private async emitTicketNotifications(p: {
    clientId: string;
    ticketId: string;
    ticketNumber: string;
    subject: string;
    creatorUserId: string;
    assignedConsultantId: string | null;
  }) {
    const label = `${p.ticketNumber} — ${p.subject}`;
    try {
      // Acknowledge the customer who raised it.
      await this.notifications.notify({
        clientId: p.clientId, userId: p.creatorUserId, type: 'TICKET_ACK', ticketId: p.ticketId,
        title: 'Ticket received',
        body: `We've received your ticket ${p.ticketNumber} and will get back to you shortly.`,
      });
      // Alert every provider admin.
      const admins = await this.prisma.user.findMany({
        where: { clientId: p.clientId, isActive: true, userRoles: { some: { role: { name: 'Admin' } } } },
        select: { id: true },
      });
      await this.notifications.notifyMany(admins.map((a) => a.id), {
        clientId: p.clientId, type: 'TICKET_CREATED', ticketId: p.ticketId,
        title: 'New ticket created', body: `New ticket ${label}`,
      });
      // Alert the assigned consultant.
      if (p.assignedConsultantId) {
        await this.notifications.notify({
          clientId: p.clientId, userId: p.assignedConsultantId, type: 'TICKET_ASSIGNED', ticketId: p.ticketId,
          title: 'Ticket assigned to you', body: `You've been assigned ${label}`,
        });
      }
    } catch (err) {
      this.logger.error('Failed to emit ticket notifications', err instanceof Error ? err.stack : String(err));
    }
  }

  findAll(clientId: string, viewer: TicketViewer) {
    return this.prisma.ticket.findMany({
      // Non-admins see tickets assigned to them, plus any they've been asked to approve.
      where: {
        clientId,
        ...(isCustomerAdmin(viewer)
          ? // A customer company admin sees all of their company's tickets.
            { customerCompanyId: viewer.customerCompanyId ?? '__none__' }
          : isCustomerEmployee(viewer)
          ? // An employee sees only the tickets they raised.
            { customerCompanyId: viewer.customerCompanyId ?? '__none__', requestorUserId: viewer.id }
          : isAdmin(viewer)
          ? // Admin sees everything except tickets still inside the customer's
            // own approval stage (not yet forwarded to us).
            { approvalStatus: { not: 'PENDING_CUSTOMER' } }
          : {
              // Agents never see tickets still awaiting approval.
              approvalStatus: { in: ['NONE', 'APPROVED'] },
              OR: [
                { technicians: { some: { userId: viewer.id } } },
                { approvals: { some: { approverUserId: viewer.id } } },
                // Tickets on which the viewer has an assigned task (possibly created by another agent).
                { tasks: { some: { assigneeUserId: viewer.id } } },
              ],
            }),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        template: { select: { id: true, name: true, category: true } },
        technicians: {
          include: { user: { select: { id: true, username: true } } },
        },
        customerCompany: { select: { id: true, name: true } },
      },
    });
  }

  async findOne(id: string, clientId: string, viewer?: TicketViewer) {
    const ticket = await this.prisma.ticket.findFirst({
      where: { id, clientId },
      include: {
        template: { include: { fields: { orderBy: { sortOrder: 'asc' } } } },
        technicians: {
          include: { user: { select: { id: true, username: true } } },
        },
        attachments: true,
        customerCompany: { select: { id: true, name: true } },
        project: { select: { id: true, name: true, projectNumber: true } },
      },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    // Enrich with SAP product/module names for display (scalar IDs → names).
    const [product, module, reopenedBy, reopenWindow, autoClose, worklogTotal, openTasks] = await Promise.all([
      ticket.productId ? this.prisma.product.findUnique({ where: { id: ticket.productId }, select: { name: true, code: true } }) : null,
      ticket.moduleId ? this.prisma.productModule.findUnique({ where: { id: ticket.moduleId }, select: { name: true } }) : null,
      // Who sent it back — staff see the name on the reopen notice; the client
      // gets neutral wording, since they already know it was them.
      ticket.reopenedById
        ? this.prisma.user.findUnique({ where: { id: ticket.reopenedById }, select: { username: true } })
        : null,
      this.reopenWindow(clientId, ticket.resolvedAt),
      this.autoCloseWindow(clientId, ticket),
      // Total time on the ticket, and what still blocks resolving it. Both are on
      // the ticket itself rather than left to the worklog/task endpoints so a
      // customer — who may not call either — still sees the hours their contract
      // is being charged, on an open ticket and a closed one alike.
      this.prisma.ticketWorklog.aggregate({ where: { ticketId: id }, _sum: { hours: true } }),
      this.prisma.ticketTask.count({
        where: { ticketId: id, status: { notIn: SETTLED_TASK_STATUSES } },
      }),
    ]);
    Object.assign(ticket, {
      productName: product?.name ?? null,
      productCode: product?.code ?? null,
      moduleName: module?.name ?? null,
      reopenedByName: reopenedBy?.username ?? null,
      // Reopen window — the screen shows the deadline, hides the button past it
      // and points the user at a new ticket instead. Same helper `reopen()` uses.
      // Whether *this* viewer may reopen is a separate rule the screen applies:
      // only the client's own people can, never provider staff.
      reopenWindowDays: reopenWindow.windowDays,
      reopenDeadline: reopenWindow.reopenDeadline,
      reopenWindowOpen: reopenWindow.windowOpen,
      // When this resolution closes itself if nobody acknowledges it. Null on
      // anything that isn't a client ticket waiting for sign-off, so the banner
      // can render the line off its presence alone.
      autoCloseDays: autoClose.days,
      autoCloseAt: autoClose.at,
      // Σ worklog hours — the same figure the Tasks tab's time list totals and the customer's
      // support-hours pool is charged, so every surface quotes one number.
      totalHoursSpent: Number(worklogTotal._sum.hours ?? 0),
      openTaskCount: openTasks,
    });
    // Customer side: must be the same company; an employee is further limited to
    // the tickets they raised, while the company admin sees all of them.
    if (viewer && isCustomerSide(viewer)) {
      const sameCompany =
        !!viewer.customerCompanyId && ticket.customerCompanyId === viewer.customerCompanyId;
      if (!sameCompany) throw new NotFoundException('Ticket not found');
      if (isCustomerEmployee(viewer) && ticket.requestorUserId !== viewer.id) {
        throw new NotFoundException('Ticket not found');
      }
      return ticket;
    }
    // A non-admin can access a ticket they're assigned to, a named approver on,
    // or one where they have an assigned task (possibly created by another agent).
    if (viewer && !isAdmin(viewer) && !ticket.technicians.some((t) => t.user.id === viewer.id)) {
      const [isApprover, isTaskAssignee] = await Promise.all([
        this.prisma.ticketApproval.findFirst({
          where: { ticketId: id, approverUserId: viewer.id },
          select: { id: true },
        }),
        this.prisma.ticketTask.findFirst({
          where: { ticketId: id, assigneeUserId: viewer.id },
          select: { id: true },
        }),
      ]);
      if (!isApprover && !isTaskAssignee) throw new NotFoundException('Ticket not found');
    }
    return ticket;
  }

  async update(
    id: string,
    clientId: string,
    dto: UpdateTicketDto,
    actorId: string,
    viewer: TicketViewer,
  ) {
    const ticket = await this.findOne(id, clientId, viewer);

    // A status change can carry two lifecycle events: closing the ticket (stamps
    // closedDate) or resolving it (stamps resolvedAt and notifies the client).
    let closedDate = ticket.closedDate;
    let resolvedAt = ticket.resolvedAt;
    let resolvedById = ticket.resolvedById;
    let nowResolved = false;
    // When the status last moved. Stamped here so the detail screen can say how
    // long the ticket has stood where it is without walking the audit log.
    let statusChangedAt = ticket.statusChangedAt;
    // Display labels for the audit entry, so History reads "Open to In progress"
    // rather than quoting the tenant's raw picklist codes at the reader.
    let fromLabel = ticket.ticketStatus;
    let toLabel = dto.ticketStatus ?? ticket.ticketStatus;
    if (dto.ticketStatus && dto.ticketStatus !== ticket.ticketStatus) {
      const label = await this.statusLabel(clientId, dto.ticketStatus);
      statusChangedAt = new Date();
      [fromLabel, toLabel] = await Promise.all([
        this.statusDisplay(clientId, ticket.ticketStatus),
        this.statusDisplay(clientId, dto.ticketStatus),
      ]);
      if (label === 'closed') this.assertStaffMayClose(ticket);
      if (label === 'resolved' || label === 'closed') {
        await this.assertTasksComplete(id, label);
        await this.assertTimeLogged(id, label);
        // Only on the way in: a ticket resolved before this rule existed must
        // still be closable, and re-closing a resolved one is not a new sign-off.
        if (!ticket.resolvedAt) {
          this.assertResolutionNotes(ticket.resolution, label);
        }
      }
      if (label === 'closed' && !closedDate) closedDate = new Date();
      // Resolving from the status dropdown must stamp the same fields the
      // Resolution tab does, or the ticket still reads as "not resolved yet"
      // and the client has nothing to acknowledge.
      if (label === 'resolved' && !resolvedAt) {
        resolvedAt = new Date();
        resolvedById = actorId;
        nowResolved = true;
      }
    }

    const mergedCustomFields =
      dto.customFields !== undefined
        ? {
            ...((ticket.customFields as Record<string, unknown>) ?? {}),
            ...dto.customFields,
          }
        : undefined;

    // When priority changes, re-derive the SLA target + Due Date from the policy
    // (measured from ticket creation), unless a Due Date is explicitly supplied.
    let slaHours: number | undefined;
    let slaDue: Date | undefined;
    if (dto.priority && dto.priority !== ticket.priority) {
      const sla = await this.prisma.slaPolicy.findFirst({
        where: { clientId, priority: dto.priority, isActive: true },
      });
      if (sla) {
        slaHours = sla.resolutionHours;
        slaDue = new Date(
          new Date(ticket.createdAt).getTime() + sla.resolutionHours * 3600 * 1000,
        );
      }
    }

    const updated = await this.prisma.ticket.update({
      where: { id },
      data: {
        ticketStatus: dto.ticketStatus,
        priority: dto.priority,
        ticketCategory: dto.ticketCategory,
        subCategory: dto.subCategory,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : slaDue,
        expectedResolutionDate: dto.expectedResolutionDate
          ? new Date(dto.expectedResolutionDate)
          : slaDue,
        ...(slaHours !== undefined && { slaHours }),
        statusChangedAt,
        closedDate,
        resolvedAt,
        resolvedById,
        ...(mergedCustomFields !== undefined && {
          customFields: mergedCustomFields as Prisma.InputJsonValue,
        }),
        updatedBy: actorId,
      },
      include: {
        template: { select: { id: true, name: true, category: true } },
        technicians: {
          include: { user: { select: { id: true, username: true } } },
        },
      },
    });

    if (dto.ticketStatus && dto.ticketStatus !== ticket.ticketStatus) {
      await this.activity.log({
        ticketId: id,
        actorUserId: actorId,
        type: 'STATUS_CHANGED',
        summary: `Status changed from ${fromLabel} to ${toLabel}`,
        meta: { from: ticket.ticketStatus, to: dto.ticketStatus },
      });
      if (closedDate && !ticket.closedDate) {
        await this.activity.log({ ticketId: id, actorUserId: actorId, type: 'CLOSED', summary: 'Ticket closed' });
      }
    }
    if (dto.priority && dto.priority !== ticket.priority) {
      await this.activity.log({
        ticketId: id,
        actorUserId: actorId,
        type: 'PRIORITY_CHANGED',
        summary: `Priority changed to ${dto.priority}`,
        meta: { from: ticket.priority, to: dto.priority },
      });
    }
    // Only on the transition into Resolved — re-saving a resolved ticket must
    // not notify the client twice.
    if (nowResolved) {
      await this.activity.log({ ticketId: id, actorUserId: actorId, type: 'RESOLVED', summary: 'Ticket resolved' });
      await this.notifyResolved(updated, clientId);
    }
    return updated;
  }

  async assignTechnicians(
    id: string,
    clientId: string,
    userIds: string[],
    actorId: string,
    viewer: TicketViewer,
  ) {
    // A ticket may have at most one agent assigned.
    if (userIds.length > 1) {
      throw new BadRequestException('Only one agent can be assigned to a ticket');
    }
    const ticket = await this.findOne(id, clientId, viewer);
    // Can't assign an agent to a ticket that hasn't cleared approval yet.
    if (ticket.approvalStatus !== 'NONE' && ticket.approvalStatus !== 'APPROVED') {
      throw new BadRequestException('This ticket is awaiting approval and cannot be assigned yet');
    }

    const ownedUsers = await this.prisma.user.count({
      where: { id: { in: userIds }, clientId },
    });
    if (ownedUsers !== userIds.length) {
      throw new BadRequestException(
        'One or more users do not belong to your organization',
      );
    }

    // Who held it before — read *before* the deleteMany below wipes the rows, or
    // the outgoing agent is unrecoverable and cannot be told they've handed it on.
    const previous = (
      await this.prisma.ticketTechnician.findMany({
        where: { ticketId: id },
        include: { user: { select: { id: true, username: true, email: true } } },
      })
    ).map((t) => t.user);

    await this.prisma.ticketTechnician.deleteMany({ where: { ticketId: id } });
    if (userIds.length) {
      await this.prisma.ticketTechnician.createMany({
        data: userIds.map((userId) => ({ ticketId: id, userId })),
      });
    }
    await this.prisma.ticket.update({
      where: { id },
      data: { updatedBy: actorId },
    });

    const incoming = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, username: true, email: true },
        })
      : [];
    const assignees = incoming.length ? incoming.map((u) => u.username).join(', ') : 'nobody';
    await this.activity.log({
      ticketId: id,
      actorUserId: actorId,
      type: 'ASSIGNED',
      summary: `Assigned to ${assignees}`,
      meta: { userIds },
    });

    // Only on a real change: re-PUTting the same agent is idempotent and must not
    // send a second round of mail to the client.
    const changed =
      previous.length !== incoming.length ||
      previous.some((p) => !incoming.some((n) => n.id === p.id));
    if (changed) {
      await this.notifyReassignment(ticket, clientId, actorId, previous, incoming);
    }

    return this.findOne(id, clientId);
  }

  // ---- Activity (History) --------------------------------------------------

  async getActivity(id: string, clientId: string, viewer: TicketViewer) {
    await this.findOne(id, clientId, viewer);
    const activities = await this.activity.list(id);
    const actorIds = Array.from(
      new Set(activities.map((a) => a.actorUserId).filter((x): x is string => !!x)),
    );
    const users = actorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, username: true },
        })
      : [];
    const nameById = new Map(users.map((u) => [u.id, u.username]));
    return activities.map((a) => ({
      ...a,
      actorName: a.actorName ?? (a.actorUserId ? nameById.get(a.actorUserId) ?? null : null),
    }));
  }

  // ---- Resolution ----------------------------------------------------------

  async setResolution(
    id: string,
    clientId: string,
    dto: { resolution?: string; ticketStatus?: string },
    actorId: string,
    viewer: TicketViewer,
  ) {
    const ticket = await this.findOne(id, clientId, viewer);
    // Editing the notes on an already-resolved ticket is not a new resolution —
    // it must not re-notify the client.
    const wasResolved = !!ticket.resolvedAt;
    // Only on the way in — editing the notes of a ticket resolved before this
    // rule existed must not be blocked by it.
    if (!wasResolved) {
      await this.assertTasksComplete(id, 'resolved');
      await this.assertTimeLogged(id, 'resolved');
      this.assertResolutionNotes(dto.resolution, 'resolved');
    }
    const resolvedStatus = dto.ticketStatus || 'Resolved';
    // This endpoint takes a status, so it is a second door into Closed — same rule.
    if ((await this.statusLabel(clientId, resolvedStatus)) === 'closed') {
      this.assertStaffMayClose(ticket);
    }
    const updated = await this.prisma.ticket.update({
      where: { id },
      data: {
        resolution: dto.resolution,
        resolvedAt: ticket.resolvedAt ?? new Date(),
        resolvedById: ticket.resolvedById ?? actorId,
        ticketStatus: resolvedStatus,
        ...(resolvedStatus !== ticket.ticketStatus && { statusChangedAt: new Date() }),
        updatedBy: actorId,
      },
    });
    await this.activity.log({
      ticketId: id,
      actorUserId: actorId,
      type: 'RESOLVED',
      summary: wasResolved ? 'Resolution updated' : 'Ticket resolved',
    });
    if (!wasResolved) await this.notifyResolved(updated, clientId);
    return updated;
  }

  /**
   * The client confirms the resolution — the one customer-side transition that
   * closes a ticket. findOne() has already scoped the ticket to the viewer's
   * tenant and customer company (and, for an employee, to the tickets they raised),
   * and CustomerContactGuard keeps staff out of this route entirely.
   */
  async acknowledge(id: string, clientId: string, actorId: string, viewer: TicketViewer) {
    const ticket = await this.findOne(id, clientId, viewer);
    // `acknowledgedAt` is the duplicate guard — one acknowledgement per resolution.
    if (ticket.acknowledgedAt) {
      throw new BadRequestException('This ticket has already been acknowledged');
    }
    const label = await this.statusLabel(clientId, ticket.ticketStatus);
    if (label === 'closed' || ticket.closedDate) {
      throw new BadRequestException('This ticket is already closed');
    }
    if (label !== 'resolved') {
      throw new BadRequestException('Only a resolved ticket can be acknowledged');
    }
    // No time check here: the ticket cleared it on the way into Resolved, and the
    // client has neither the ability nor the standing to log our hours.
    const now = new Date();
    const updated = await this.prisma.ticket.update({
      where: { id },
      data: {
        acknowledgedAt: now,
        acknowledgedById: actorId,
        ticketStatus: await this.closedStatusValue(clientId),
        statusChangedAt: now,
        closedDate: now,
        updatedBy: actorId,
      },
    });
    await this.activity.log({
      ticketId: id,
      actorUserId: actorId,
      type: 'ACKNOWLEDGED',
      summary: 'Resolution acknowledged by the client',
    });
    await this.activity.log({
      ticketId: id,
      actorUserId: actorId,
      type: 'CLOSED',
      summary: 'Ticket closed on client acknowledgement',
    });
    await this.notifyAcknowledged(updated, clientId);
    return updated;
  }

  /**
   * Close every client ticket whose resolution has sat unacknowledged past the
   * tenant's window (`Client.ticketAutoCloseDays`, default 3). Silence reads as
   * acceptance — without this a resolved ticket nobody signs off stays open
   * forever, since only the client may close it (see `assertStaffMayClose`).
   * Internal tickets are skipped: they have no client to ask and staff close
   * them directly.
   *
   * Reopening is untouched — that window is measured from `resolvedAt` and is
   * independent of the close, so a client who comes back inside it can still
   * send the ticket back. Run by `TicketAutoCloseService` on a timer; every
   * failure is per-ticket so one bad row can't stop the sweep.
   */
  async autoCloseUnacknowledged() {
    const clients = await this.prisma.client.findMany({
      select: { id: true, ticketAutoCloseDays: true },
    });
    let closed = 0;
    for (const client of clients) {
      const days = client.ticketAutoCloseDays ?? DEFAULT_AUTO_CLOSE_DAYS;
      const cutoff = new Date(Date.now() - days * DAY_MS);
      const candidates = await this.prisma.ticket.findMany({
        where: {
          clientId: client.id,
          customerCompanyId: { not: null },
          resolvedAt: { not: null, lte: cutoff },
          acknowledgedAt: null,
          closedDate: null,
        },
        select: {
          id: true,
          ticketNumber: true,
          subject: true,
          ticketStatus: true,
          requestorUserId: true,
          requestorEmail: true,
          requestorName: true,
          customerCompanyId: true,
          resolvedById: true,
        },
      });
      if (candidates.length === 0) continue;
      // `resolvedAt` alone doesn't prove the ticket is still resolved — moving it
      // back to In Progress leaves the stamp in place — so the live status has to
      // agree before we close anything.
      const resolvedValues = await this.resolvedStatusValues(client.id);
      const due = candidates.filter((t) => resolvedValues.has(t.ticketStatus));
      if (due.length === 0) continue;
      const closedStatus = await this.closedStatusValue(client.id);

      for (const ticket of due) {
        try {
          const now = new Date();
          await this.prisma.ticket.update({
            where: { id: ticket.id },
            data: { ticketStatus: closedStatus, statusChangedAt: now, closedDate: now },
          });
          await this.activity.log({
            ticketId: ticket.id,
            actorName: 'System',
            type: 'CLOSED',
            summary: `Ticket closed automatically — the resolution went unacknowledged for ${days} day(s)`,
          });
          await this.notifyAutoClosed(ticket, client.id, days);
          closed += 1;
        } catch (err) {
          this.logger.error(
            `Auto-close failed for ${ticket.ticketNumber}`,
            err instanceof Error ? err.stack : String(err),
          );
        }
      }
    }
    return { closed };
  }

  /**
   * Tell both sides a ticket closed itself: the client (requestor + their admins),
   * so the close is never a surprise, and the agents who worked it. Best-effort —
   * a notification failure must not undo the close.
   */
  private async notifyAutoClosed(
    ticket: {
      id: string;
      ticketNumber: string;
      subject: string;
      requestorUserId: string | null;
      requestorEmail: string | null;
      requestorName: string | null;
      customerCompanyId: string | null;
      resolvedById: string | null;
    },
    clientId: string,
    days: number,
  ) {
    const label = `${ticket.ticketNumber} — ${ticket.subject}`;
    try {
      const [companyAdmins, technicians] = await Promise.all([
        ticket.customerCompanyId
          ? this.prisma.user.findMany({
              where: {
                clientId,
                customerCompanyId: ticket.customerCompanyId,
                isActive: true,
                userRoles: { some: { role: { name: 'CustomerAdmin' } } },
              },
              select: { id: true },
            })
          : Promise.resolve([]),
        this.prisma.ticketTechnician.findMany({
          where: { ticketId: ticket.id },
          select: { userId: true },
        }),
      ]);
      const recipients = new Set<string>([
        ...companyAdmins.map((a) => a.id),
        ...technicians.map((t) => t.userId),
      ]);
      if (ticket.requestorUserId) recipients.add(ticket.requestorUserId);
      if (ticket.resolvedById) recipients.add(ticket.resolvedById);
      await this.notifications.notifyMany([...recipients], {
        clientId,
        type: 'TICKET_CLOSED',
        ticketId: ticket.id,
        title: 'Ticket closed automatically',
        body: `${label} was resolved more than ${days} day(s) ago and had no acknowledgement, so it has been closed.`,
      });
    } catch (err) {
      this.logger.error(
        `Failed to emit auto-close notification for ${ticket.ticketNumber}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
    try {
      if (!ticket.requestorEmail) return;
      if (!(await this.mailer.isConfigured(clientId))) return;
      const text = `Your ticket ${ticket.ticketNumber} ("${ticket.subject}") was marked resolved more than ${days} day(s) ago. As we didn't hear back, it has now been closed.`;
      const html = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto;">
          <div style="background:#334155; padding:24px; border-radius:12px 12px 0 0; text-align:center;">
            <h1 style="color:#fff; margin:0; font-size:18px;">Your ticket has been closed</h1>
          </div>
          <div style="background:#fff; padding:28px; border:1px solid #e5e7eb; border-top:none; border-radius:0 0 12px 12px;">
            <p style="color:#374151; font-size:14px;">Hi ${ticket.requestorName ?? 'there'},</p>
            <p style="color:#374151; font-size:14px;">Your ticket <strong>${ticket.ticketNumber}</strong> — “${ticket.subject}” — was marked <strong>resolved</strong> more than ${days} day(s) ago. As we didn't hear back, it has now been closed.</p>
            <p style="color:#6b7280; font-size:12px; margin-top:20px;">If the issue is still there, sign in and reopen the ticket — or raise a new one.</p>
          </div>
        </div>`;
      await this.mailer.sendMail(
        { to: ticket.requestorEmail, subject: `Your ticket ${ticket.ticketNumber} has been closed`, html, text },
        clientId,
      );
    } catch (err) {
      this.logger.error(
        `Failed to email the auto-close of ${ticket.ticketNumber}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  /**
   * A client's ticket closes only when that client acknowledges the resolution:
   * staff resolve it, the client signs off (see acknowledge()). Internal tickets —
   * no customer company on them — keep the direct staff close.
   */
  private assertStaffMayClose(ticket: { customerCompanyId: string | null }) {
    if (ticket.customerCompanyId) {
      throw new BadRequestException(
        'This ticket belongs to a client, so only their acknowledgement can close it. Mark it Resolved instead — the client is notified and closes it by acknowledging the resolution.',
      );
    }
  }

  /**
   * Resolving or closing a ticket requires time on it. Worklogs are what feed the
   * customer's support-hours pool and the AMC draw-down, so a ticket signed off
   * with an empty timesheet silently under-bills the contract.
   */
  private async assertTimeLogged(ticketId: string, action: 'resolved' | 'closed') {
    const totals = await this.prisma.ticketWorklog.aggregate({
      where: { ticketId },
      _sum: { hours: true },
    });
    if (!(Number(totals._sum.hours ?? 0) > 0)) {
      throw new BadRequestException(
        `Log the time spent on this ticket before marking it ${action}`,
      );
    }
  }

  /**
   * A ticket cannot be signed off while work on it is still outstanding. A task is
   * settled when it is DONE or explicitly CANCELLED — cancelling is the honest way
   * to clear a task that turned out not to be needed, rather than ticking it done
   * or deleting the record. A ticket with no tasks is unaffected.
   */
  private async assertTasksComplete(ticketId: string, action: 'resolved' | 'closed') {
    const open = await this.prisma.ticketTask.count({
      where: { ticketId, status: { notIn: SETTLED_TASK_STATUSES } },
    });
    if (open > 0) {
      throw new BadRequestException(
        `${open} task${open === 1 ? ' is' : 's are'} still open on this ticket — complete or cancel ${open === 1 ? 'it' : 'them'} before marking it ${action}`,
      );
    }
  }

  /**
   * A ticket cannot be signed off with nothing said about how. The notes are what
   * the client is asked to acknowledge, and what they judge a reopen on, so an
   * empty resolution makes the whole acknowledge/close loop meaningless.
   */
  private assertResolutionNotes(
    resolution: string | null | undefined,
    action: 'resolved' | 'closed',
  ) {
    if (!resolution?.trim()) {
      throw new BadRequestException(
        `Write a resolution message before marking this ticket ${action}`,
      );
    }
  }

  /**
   * The meaning of a status *value* for this tenant. Statuses are tenant-configurable
   * picklist rows, so match on the option's label and fall back to the raw value —
   * the same rule the closed-date stamp has always used.
   */
  private async statusLabel(clientId: string, value: string) {
    const option = await this.prisma.picklistOption.findFirst({
      where: { clientId, listKey: 'ticketStatus', value },
    });
    return (option?.label ?? value).trim().toLowerCase();
  }

  /**
   * The same lookup as `statusLabel()` but keeping the tenant's own casing, for
   * text a person reads. `statusLabel()` lower-cases because it is compared
   * against literals like 'resolved'; an audit line must not shout the result of
   * that back at the reader.
   */
  private async statusDisplay(clientId: string, value: string) {
    const option = await this.prisma.picklistOption.findFirst({
      where: { clientId, listKey: 'ticketStatus', value },
    });
    return (option?.label ?? value).trim();
  }

  /**
   * Every status *value* this tenant treats as "Resolved" — the auto-close sweep
   * checks membership per ticket, so it reads the list once instead of hitting
   * `statusLabel()` for each row.
   */
  private async resolvedStatusValues(clientId: string) {
    const options = await this.prisma.picklistOption.findMany({
      where: { clientId, listKey: 'ticketStatus' },
      select: { value: true, label: true },
    });
    const values = options
      .filter((o) => (o.label ?? o.value).trim().toLowerCase() === 'resolved')
      .map((o) => o.value);
    // A tenant with no picklist row still uses the seeded literal.
    return new Set(values.length ? values : ['Resolved']);
  }

  /** This tenant's own "Closed" status value, falling back to the seeded 'Closed'. */
  private async closedStatusValue(clientId: string) {
    const options = await this.prisma.picklistOption.findMany({
      where: { clientId, listKey: 'ticketStatus', isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { value: true, label: true },
    });
    return (
      options.find((o) => (o.label ?? o.value).trim().toLowerCase() === 'closed')?.value ?? 'Closed'
    );
  }

  /**
   * When an unacknowledged resolution will close itself. Only a client ticket
   * that is resolved, unacknowledged and still open has a date — everything else
   * returns null, so the ticket screen shows the deadline exactly when the sweep
   * in `autoCloseUnacknowledged()` would act on it.
   */
  private async autoCloseWindow(
    clientId: string,
    ticket: {
      resolvedAt: Date | null;
      acknowledgedAt: Date | null;
      closedDate: Date | null;
      customerCompanyId: string | null;
    },
  ) {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { ticketAutoCloseDays: true },
    });
    const days = client?.ticketAutoCloseDays ?? DEFAULT_AUTO_CLOSE_DAYS;
    const waiting =
      !!ticket.customerCompanyId && !!ticket.resolvedAt && !ticket.acknowledgedAt && !ticket.closedDate;
    if (!waiting) return { days, at: null };
    return { days, at: new Date(ticket.resolvedAt!.getTime() + days * DAY_MS) };
  }

  /**
   * The tenant's reopen window and where a given resolution sits inside it.
   * An unresolved ticket has no deadline and is always reopenable (the button is
   * hidden anyway); a resolved one stops being reopenable `windowDays` after
   * `resolvedAt`. Shape is shared by the enforcement in `reopen()` and the
   * `findOne()` projection the ticket screen renders from, so both agree. This is
   * purely about *time* — who may reopen is a separate rule (customer side only).
   */
  private async reopenWindow(clientId: string, resolvedAt?: Date | null) {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { ticketReopenWindowDays: true },
    });
    const windowDays = client?.ticketReopenWindowDays ?? DEFAULT_REOPEN_WINDOW_DAYS;
    if (!resolvedAt) return { windowDays, reopenDeadline: null, windowOpen: true };
    const reopenDeadline = new Date(resolvedAt.getTime() + windowDays * DAY_MS);
    return { windowDays, reopenDeadline, windowOpen: Date.now() <= reopenDeadline.getTime() };
  }

  async reopen(
    id: string,
    clientId: string,
    dto: { reason?: string },
    actorId: string,
    viewer: TicketViewer,
  ) {
    const ticket = await this.findOne(id, clientId, viewer);
    // Reopening says the fix didn't hold — on a customer's ticket that is the
    // client's call alone, so provider staff (admins and consultants alike) are
    // refused. An internal ticket has no client to make the call, so it stays with
    // staff, the same way internal tickets keep the direct close.
    if (ticket.customerCompanyId && !isCustomerSide(viewer)) {
      throw new ForbiddenException(
        'Only the client can reopen their own ticket. Raise a new ticket if the issue needs more work.',
      );
    }
    // A resolved ticket only stays reopenable for the tenant's window; after that
    // the issue is a fresh ticket, not a revival of an old one.
    const window = await this.reopenWindow(clientId, ticket.resolvedAt);
    if (!window.windowOpen) {
      throw new BadRequestException(
        `This ticket was resolved more than ${window.windowDays} days ago and can no longer be reopened. Please create a new ticket instead.`,
      );
    }
    // Why it's coming back is the whole point of the action — the agents get it
    // as a notification and the history keeps it.
    const reason = dto?.reason?.trim();
    if (!reason) {
      throw new BadRequestException('Tell us why this ticket needs to be reopened');
    }
    const reopenStatus =
      (
        await this.prisma.picklistOption.findFirst({
          where: { clientId, listKey: 'ticketStatus', isActive: true },
          orderBy: { sortOrder: 'asc' },
        })
      )?.value ?? 'Open';
    const updated = await this.prisma.ticket.update({
      where: { id },
      data: {
        resolvedAt: null,
        resolvedById: null,
        closedDate: null,
        // Clear the sign-off too: the next resolution needs its own acknowledgement,
        // and a stale stamp would make the duplicate guard reject it forever.
        acknowledgedAt: null,
        acknowledgedById: null,
        ticketStatus: reopenStatus,
        statusChangedAt: new Date(),
        reopenedCount: { increment: 1 },
        reopenReason: reason,
        reopenedAt: new Date(),
        reopenedById: actorId,
        updatedBy: actorId,
      },
    });
    await this.activity.log({
      ticketId: id,
      actorUserId: actorId,
      type: 'REOPENED',
      summary: `Ticket reopened: ${reason}`,
    });
    // The people who worked it need to know it's back, and why.
    await this.notifyReopened(ticket, clientId, reason, actorId);
    return updated;
  }

  /**
   * Push a reopen to the people who have to act on it: every assigned agent, whoever
   * resolved it, and the tenant's admins. Best-effort — a notification failure must
   * never undo a reopen the client already made.
   */
  private async notifyReopened(
    ticket: { id: string; ticketNumber: string; subject: string; resolvedById: string | null },
    clientId: string,
    reason: string,
    actorId: string,
  ) {
    try {
      const [technicians, admins] = await Promise.all([
        this.prisma.ticketTechnician.findMany({
          where: { ticketId: ticket.id },
          select: { userId: true },
        }),
        this.prisma.user.findMany({
          where: {
            clientId,
            isActive: true,
            userRoles: { some: { role: { name: 'Admin' } } },
          },
          select: { id: true },
        }),
      ]);
      const recipients = new Set([
        ...technicians.map((t) => t.userId),
        ...admins.map((a) => a.id),
      ]);
      if (ticket.resolvedById) recipients.add(ticket.resolvedById);
      recipients.delete(actorId); // the client who reopened it needs no ping
      await this.notifications.notifyMany([...recipients], {
        clientId,
        type: 'TICKET_REOPENED',
        ticketId: ticket.id,
        title: 'Ticket reopened by the client',
        body: `${ticket.ticketNumber} — ${ticket.subject}. Reason: ${reason}`,
      });
    } catch (err) {
      this.logger.error(
        `Failed to emit reopen notification for ${ticket.ticketNumber}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  // ---- Creation-approval gate (Admin approves/rejects customer tickets) ----

  async approve(id: string, clientId: string, actorId: string, viewer: TicketViewer) {
    const ticket = await this.findOne(id, clientId, viewer);
    if (ticket.approvalStatus !== 'PENDING') {
      throw new BadRequestException('Only tickets awaiting approval can be approved');
    }
    const initial =
      (
        await this.prisma.picklistOption.findFirst({
          where: { clientId, listKey: 'ticketStatus', isActive: true },
          orderBy: { sortOrder: 'asc' },
        })
      )?.value ?? 'Open';
    const updated = await this.prisma.ticket.update({
      where: { id },
      data: {
        approvalStatus: 'APPROVED',
        approvedById: actorId,
        approvedAt: new Date(),
        // Now a real, assignable ticket — move it to the default open status.
        ticketStatus: initial,
        statusChangedAt: new Date(),
        updatedBy: actorId,
      },
    });
    await this.activity.log({
      ticketId: id,
      actorUserId: actorId,
      type: 'APPROVED',
      summary: 'Ticket approved',
    });
    return updated;
  }

  async reject(
    id: string,
    clientId: string,
    dto: { reason?: string },
    actorId: string,
    viewer: TicketViewer,
  ) {
    const ticket = await this.findOne(id, clientId, viewer);
    if (ticket.approvalStatus !== 'PENDING') {
      throw new BadRequestException('Only tickets awaiting approval can be rejected');
    }
    const reason = dto.reason?.trim();
    if (!reason) {
      throw new BadRequestException('A rejection reason is required');
    }
    const updated = await this.prisma.ticket.update({
      where: { id },
      data: {
        approvalStatus: 'REJECTED',
        rejectionReason: reason,
        rejectedById: actorId,
        rejectedAt: new Date(),
        ticketStatus: 'Rejected',
        statusChangedAt: new Date(),
        updatedBy: actorId,
      },
    });
    await this.activity.log({
      ticketId: id,
      actorUserId: actorId,
      type: 'REJECTED',
      summary: 'Ticket request rejected',
      meta: { reason },
    });
    await this.notifyRejection(updated, clientId);
    return updated;
  }

  // ---- Stage 1: customer company admin approves/rejects an employee ticket ----

  async customerApprove(id: string, clientId: string, actorId: string, viewer: TicketViewer) {
    const ticket = await this.findOne(id, clientId, viewer);
    if (ticket.approvalStatus !== 'PENDING_CUSTOMER') {
      throw new BadRequestException('Only tickets awaiting your approval can be approved');
    }
    // Forward it on to the provider's Admin for the final approval.
    const updated = await this.prisma.ticket.update({
      where: { id },
      data: { approvalStatus: 'PENDING', updatedBy: actorId },
    });
    await this.activity.log({
      ticketId: id,
      actorUserId: actorId,
      type: 'CUSTOMER_APPROVED',
      summary: 'Approved by company admin — sent for provider approval',
    });
    return updated;
  }

  async customerReject(
    id: string,
    clientId: string,
    dto: { reason?: string },
    actorId: string,
    viewer: TicketViewer,
  ) {
    const ticket = await this.findOne(id, clientId, viewer);
    if (ticket.approvalStatus !== 'PENDING_CUSTOMER') {
      throw new BadRequestException('Only tickets awaiting your approval can be rejected');
    }
    const reason = dto.reason?.trim();
    if (!reason) {
      throw new BadRequestException('A rejection reason is required');
    }
    const updated = await this.prisma.ticket.update({
      where: { id },
      data: {
        approvalStatus: 'REJECTED',
        rejectionReason: reason,
        rejectedById: actorId,
        rejectedAt: new Date(),
        ticketStatus: 'Rejected',
        statusChangedAt: new Date(),
        updatedBy: actorId,
      },
    });
    await this.activity.log({
      ticketId: id,
      actorUserId: actorId,
      type: 'REJECTED',
      summary: 'Ticket rejected by company admin',
      meta: { reason },
    });
    await this.notifyRejection(updated, clientId);
    return updated;
  }

  /**
   * Tell the client their ticket is resolved: an in-app notification for the
   * requestor plus their company's admins — exactly the people allowed to
   * acknowledge it — and a best-effort email to the requestor.
   *
   * Never throws: a notification failure must not undo the resolution.
   */
  private async notifyResolved(
    ticket: {
      id: string;
      ticketNumber: string;
      subject: string;
      requestorUserId: string | null;
      requestorEmail: string | null;
      requestorName: string | null;
      customerCompanyId: string | null;
      resolution: string | null;
    },
    clientId: string,
  ) {
    const label = `${ticket.ticketNumber} — ${ticket.subject}`;
    try {
      const recipients = new Set<string>();
      if (ticket.requestorUserId) recipients.add(ticket.requestorUserId);
      if (ticket.customerCompanyId) {
        const companyAdmins = await this.prisma.user.findMany({
          where: {
            clientId,
            customerCompanyId: ticket.customerCompanyId,
            isActive: true,
            userRoles: { some: { role: { name: 'CustomerAdmin' } } },
          },
          select: { id: true },
        });
        for (const a of companyAdmins) recipients.add(a.id);
      }
      await this.notifications.notifyMany([...recipients], {
        clientId,
        type: 'TICKET_RESOLVED',
        ticketId: ticket.id,
        title: 'Ticket resolved',
        body: `${label} has been resolved. Please review and acknowledge it to close the ticket.`,
      });
    } catch (err) {
      this.logger.error(
        `Failed to emit resolution notification for ${ticket.ticketNumber}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
    try {
      if (!ticket.requestorEmail) return;
      if (!(await this.mailer.isConfigured(clientId))) {
        this.logger.warn(`SMTP not configured — resolution email for ${ticket.ticketNumber} not sent`);
        return;
      }
      const html = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto;">
          <div style="background:#047857; padding:24px; border-radius:12px 12px 0 0; text-align:center;">
            <h1 style="color:#fff; margin:0; font-size:18px;">Your ticket has been resolved</h1>
          </div>
          <div style="background:#fff; padding:28px; border:1px solid #e5e7eb; border-top:none; border-radius:0 0 12px 12px;">
            <p style="color:#374151; font-size:14px;">Hi ${ticket.requestorName ?? 'there'},</p>
            <p style="color:#374151; font-size:14px;">Your ticket <strong>${ticket.ticketNumber}</strong> — “${ticket.subject}” — has been marked <strong>resolved</strong>.</p>
            ${
              ticket.resolution?.trim()
                ? `<p style="color:#374151; font-size:14px;"><strong>Resolution:</strong></p>
            <div style="background:#f9fafb; border:1px solid #e5e7eb; border-radius:8px; padding:12px; color:#374151; font-size:14px; white-space:pre-wrap;">${ticket.resolution}</div>`
                : ''
            }
            <p style="color:#6b7280; font-size:12px; margin-top:20px;">Please sign in and acknowledge the resolution to close the ticket, or reopen it if the issue persists.</p>
          </div>
        </div>`;
      await this.mailer.sendMail(
        {
          to: ticket.requestorEmail,
          subject: `Your ticket ${ticket.ticketNumber} has been resolved`,
          html,
          text: `Your ticket ${ticket.ticketNumber} ("${ticket.subject}") has been resolved.${ticket.resolution?.trim() ? `

Resolution: ${ticket.resolution}` : ''}

Please acknowledge the resolution to close the ticket, or reopen it if the issue persists.`,
        },
        clientId,
      );
    } catch (err) {
      this.logger.error(
        `Failed to send resolution email for ${ticket.ticketNumber}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  /**
   * Announce a change of assigned agent. Never throws — a mail failure must not
   * undo the assignment.
   *
   * Five audiences, because a handover matters to everyone waiting on the ticket:
   * the incoming agent (they now own it), the outgoing one (it left their queue),
   * the requestor, the client's own admins, and the tenant admins running the
   * engagement. The person who performed the change is dropped — they know.
   *
   * The email goes out as **two** sends, so a customer's address and the
   * provider's staff addresses are never in one `To:` header.
   */
  private async notifyReassignment(
    ticket: {
      id: string;
      ticketNumber: string;
      subject: string;
      requestorUserId: string | null;
      requestorEmail: string | null;
      requestorName: string | null;
      customerCompanyId: string | null;
    },
    clientId: string,
    actorId: string,
    previous: Agent[],
    incoming: Agent[],
  ) {
    const label = `${ticket.ticketNumber} — ${ticket.subject}`;
    const to = incoming.map((u) => u.username).join(', ');
    const from = previous.map((u) => u.username).join(', ');
    // A first assignment is not a reassignment, and handing a ticket to nobody is
    // an unassignment. Each reads differently to the client.
    const handover = previous.length > 0 && incoming.length > 0;
    const summary = incoming.length
      ? handover
        ? `${label} has moved from ${from} to ${to}.`
        : `${label} has been assigned to ${to}.`
      : `${label} is no longer assigned to anyone.`;

    const [companyAdmins, tenantAdmins] = await Promise.all([
      ticket.customerCompanyId
        ? this.prisma.user.findMany({
            where: {
              clientId,
              customerCompanyId: ticket.customerCompanyId,
              isActive: true,
              userRoles: { some: { role: { name: 'CustomerAdmin' } } },
            },
            select: { id: true, email: true },
          })
        : Promise.resolve([] as { id: string; email: string | null }[]),
      this.prisma.user.findMany({
        where: { clientId, isActive: true, userRoles: { some: { role: { name: 'Admin' } } } },
        select: { id: true, email: true },
      }),
    ]);

    try {
      // The incoming agent gets the actionable one; everyone else is being kept
      // informed, so they are told separately rather than "assigned to you".
      for (const agent of incoming) {
        if (agent.id === actorId) continue; // an admin taking it themselves needs no ping
        await this.notifications.notify({
          clientId, userId: agent.id, type: 'TICKET_ASSIGNED', ticketId: ticket.id,
          title: 'Ticket assigned to you',
          body: `You've been assigned ${label}`,
        });
      }
      for (const agent of previous) {
        if (agent.id === actorId) continue;
        if (incoming.some((n) => n.id === agent.id)) continue;
        await this.notifications.notify({
          clientId, userId: agent.id, type: 'TICKET_UNASSIGNED', ticketId: ticket.id,
          title: 'Ticket reassigned',
          body: incoming.length
            ? `${label} has been handed over to ${to}.`
            : `${label} is no longer assigned to you.`,
        });
      }

      const watchers = new Set<string>([
        ...companyAdmins.map((a) => a.id),
        ...tenantAdmins.map((a) => a.id),
      ]);
      if (ticket.requestorUserId) watchers.add(ticket.requestorUserId);
      for (const agent of [...previous, ...incoming]) watchers.delete(agent.id);
      watchers.delete(actorId);
      await this.notifications.notifyMany([...watchers], {
        clientId, type: 'TICKET_REASSIGNED', ticketId: ticket.id,
        title: incoming.length ? 'Ticket reassigned' : 'Ticket unassigned',
        body: summary,
      });
    } catch (err) {
      this.logger.error(
        `Failed to emit reassignment notification for ${ticket.ticketNumber}`,
        err instanceof Error ? err.stack : String(err),
      );
    }

    try {
      if (!(await this.mailer.isConfigured(clientId))) {
        this.logger.warn(
          `SMTP not configured — reassignment email for ${ticket.ticketNumber} not sent`,
        );
        return;
      }

      // Customer-facing: the requestor and their own company's admins. They care
      // who is handling it now, not the mechanics of the handover.
      const customerTo = joinEmails([ticket.requestorEmail, ...companyAdmins.map((a) => a.email)]);
      if (customerTo) {
        const line = incoming.length
          ? `Your ticket <strong>${ticket.ticketNumber}</strong> — “${ticket.subject}” — is now being handled by <strong>${to}</strong>.`
          : `Your ticket <strong>${ticket.ticketNumber}</strong> — “${ticket.subject}” — is being reassigned, and a new agent will pick it up shortly.`;
        await this.mailer.sendMail(
          {
            to: customerTo,
            subject: `Your ticket ${ticket.ticketNumber} has a new agent`,
            html: reassignmentHtml('Your ticket has a new agent', ticket.requestorName, line),
            text: incoming.length
              ? `Your ticket ${ticket.ticketNumber} ("${ticket.subject}") is now being handled by ${to}.`
              : `Your ticket ${ticket.ticketNumber} ("${ticket.subject}") is being reassigned, and a new agent will pick it up shortly.`,
          },
          clientId,
        );
      }

      // Internal: the tenant admins running the engagement, plus the agent who now
      // owns it. Sent apart from the note above so the two audiences never see
      // each other's addresses.
      const staffTo = joinEmails([...tenantAdmins.map((a) => a.email), ...incoming.map((u) => u.email)]);
      if (staffTo) {
        await this.mailer.sendMail(
          {
            to: staffTo,
            subject: `${ticket.ticketNumber} ${incoming.length ? `assigned to ${to}` : 'unassigned'}`,
            html: reassignmentHtml('Ticket reassigned', null, summary),
            text: summary,
          },
          clientId,
        );
      }
    } catch (err) {
      this.logger.error(
        `Failed to send reassignment email for ${ticket.ticketNumber}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  /** Tell the agents who worked the ticket that the client signed it off. Never throws. */
  private async notifyAcknowledged(
    ticket: { id: string; ticketNumber: string; subject: string; resolvedById: string | null },
    clientId: string,
  ) {
    try {
      const technicians = await this.prisma.ticketTechnician.findMany({
        where: { ticketId: ticket.id },
        select: { userId: true },
      });
      const recipients = new Set(technicians.map((t) => t.userId));
      if (ticket.resolvedById) recipients.add(ticket.resolvedById);
      await this.notifications.notifyMany([...recipients], {
        clientId,
        type: 'TICKET_ACKNOWLEDGED',
        ticketId: ticket.id,
        title: 'Resolution acknowledged',
        body: `The client acknowledged ${ticket.ticketNumber} — ${ticket.subject}. The ticket is now closed.`,
      });
    } catch (err) {
      this.logger.error(
        `Failed to emit acknowledgement notification for ${ticket.ticketNumber}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  /** Best-effort email to the requestor with the rejection reason. Never throws. */
  private async notifyRejection(
    ticket: { ticketNumber: string; subject: string; requestorEmail: string | null; requestorName: string | null; rejectionReason: string | null },
    clientId: string,
  ) {
    try {
      if (!ticket.requestorEmail) return;
      if (!(await this.mailer.isConfigured(clientId))) {
        this.logger.warn(
          `SMTP not configured — rejection email for ${ticket.ticketNumber} not sent`,
        );
        return;
      }
      const html = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto;">
          <div style="background:#b91c1c; padding:24px; border-radius:12px 12px 0 0; text-align:center;">
            <h1 style="color:#fff; margin:0; font-size:18px;">Ticket request not approved</h1>
          </div>
          <div style="background:#fff; padding:28px; border:1px solid #e5e7eb; border-top:none; border-radius:0 0 12px 12px;">
            <p style="color:#374151; font-size:14px;">Hi ${ticket.requestorName ?? 'there'},</p>
            <p style="color:#374151; font-size:14px;">Your ticket <strong>${ticket.ticketNumber}</strong> — “${ticket.subject}” — was reviewed and <strong>not approved</strong>.</p>
            <p style="color:#374151; font-size:14px;"><strong>Reason:</strong></p>
            <div style="background:#f9fafb; border:1px solid #e5e7eb; border-radius:8px; padding:12px; color:#374151; font-size:14px; white-space:pre-wrap;">${ticket.rejectionReason ?? ''}</div>
            <p style="color:#6b7280; font-size:12px; margin-top:20px;">You can raise a new ticket with the requested changes.</p>
          </div>
        </div>`;
      await this.mailer.sendMail(
        {
          to: ticket.requestorEmail,
          subject: `Your ticket ${ticket.ticketNumber} was not approved`,
          html,
          text: `Your ticket ${ticket.ticketNumber} ("${ticket.subject}") was not approved.\n\nReason: ${ticket.rejectionReason ?? ''}`,
        },
        clientId,
      );
    } catch (err) {
      this.logger.error(
        `Failed to send rejection email for ${ticket.ticketNumber}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  async addAttachments(
    id: string,
    clientId: string,
    files: Express.Multer.File[],
    actorId: string,
    viewer: TicketViewer,
  ) {
    await this.findOne(id, clientId, viewer);
    if (!files?.length) return [];

    await this.prisma.ticketAttachment.createMany({
      data: files.map((file) => ({
        ticketId: id,
        fileName: file.originalname,
        filePath: `/uploads/tickets/${file.filename}`,
        mimeType: file.mimetype,
        size: file.size,
        uploadedBy: actorId,
      })),
    });

    return this.prisma.ticketAttachment.findMany({ where: { ticketId: id } });
  }

  // ---- Worklog / support-hours time tracking --------------------------------

  /**
   * The support-hours pool this ticket's logged time is drawn from, so the Time
   * tab can show what an entry spends. Worklog hours are charged to the customer's
   * pool for the *ticket's product* — that product's own warranty/AMC pool when
   * the customer is on `contractScope = PRODUCT`, the shared customer contract
   * otherwise — by the same `productSupportHours` maths the product screens and
   * the create-ticket form read, so every screen agrees on one figure.
   *
   * `scope: null` means the time lands in no pool at all: either the ticket has no
   * customer, or it carries no product while the customer is on per-product
   * coverage. The UI says so rather than silently showing nothing.
   */
  async ticketSupportHours(id: string, clientId: string, viewer: TicketViewer) {
    const ticket = await this.findOne(id, clientId, viewer);
    const identity = {
      productId: ticket.productId ?? null,
      productName: (ticket as { productName?: string | null }).productName ?? null,
    };
    const unmapped = { hasPool: false, unlimited: false, allocated: null, used: 0, left: null };
    if (!ticket.customerCompanyId) return { ...identity, ...unmapped, scope: null };
    const pool = await this.customerProducts.productSupportHours(
      clientId,
      ticket.customerCompanyId,
      ticket.productId ?? '',
    );
    return { ...identity, ...pool, scope: (pool as { scope?: string }).scope ?? null };
  }

  async listWorklogs(id: string, clientId: string, viewer: TicketViewer) {
    await this.findOne(id, clientId, viewer);
    return this.prisma.ticketWorklog.findMany({
      where: { ticketId: id },
      orderBy: { workDate: 'desc' },
    });
  }

  /**
   * Create one worklog row and roll its hours into the customer's pool.
   *
   * `addWorklog` — Log time on the Tasks tab — is now the only door in. A task's
   * own hours are an audit of how long it stood in progress and are deliberately
   * never booked here, or the same work would be charged twice.
   *
   * The allowance check is deliberately *not* in here, so a caller with a delta
   * to test rather than a fresh figure can assert its own before writing.
   */
  private async writeWorklog(
    clientId: string,
    ticket: WorklogTicket,
    p: {
      workerId: string; hours: number; workDate: Date; note: string | null;
      taskId?: string | null; taskTitle?: string | null;
    },
  ) {
    const worker = await this.prisma.user.findUnique({
      where: { id: p.workerId },
      select: { username: true },
    });
    const worklog = await this.prisma.ticketWorklog.create({
      data: {
        clientId,
        ticketId: ticket.id,
        userId: p.workerId,
        consultantName: worker?.username ?? null,
        workDate: p.workDate,
        hours: p.hours,
        note: p.note,
        taskId: p.taskId ?? null,
        // Denormalised beside the id: the link is SetNull, so the entry must keep
        // saying what the time was for once the task itself is gone.
        taskTitle: p.taskTitle ?? null,
        createdBy: p.workerId,
      },
    });

    // A MONTHLY pool tracks usage in its ledger; no-op for FULL_AMC / unlimited.
    await this.customerProducts.adjustLoggedHours(
      clientId, ticket.customerCompanyId, ticket.productId ?? null, p.hours, worklog.workDate,
    );
    // Rolling the new hours into the pool may trip the "hours low" alert. Routed
    // through the customer's own coverage scope so the threshold is measured on
    // the pool that actually governs this ticket, not a company-wide total.
    await this.customerProducts.alertOnLoggedHours(
      clientId,
      ticket.customerCompanyId,
      ticket.productId ?? null,
    );
    return worklog;
  }

  /**
   * Delete one worklog row and reverse the ledger draw-down for the month the work
   * was logged in. Returns false when the row is already gone — the task timer
   * tolerates that (the entry may have been removed from the time list), while
   * `deleteWorklog` turns it into a 404.
   */
  private async dropWorklog(clientId: string, ticket: WorklogTicket, worklogId: string) {
    const wl = await this.prisma.ticketWorklog.findFirst({
      where: { id: worklogId, ticketId: ticket.id },
    });
    if (!wl) return false;
    await this.prisma.ticketWorklog.delete({ where: { id: worklogId } });
    await this.customerProducts.adjustLoggedHours(
      clientId, ticket.customerCompanyId, ticket.productId ?? null, -Number(wl.hours), wl.workDate,
    );
    return true;
  }

  async addWorklog(id: string, dto: CreateWorklogDto, clientId: string, actorId: string, viewer: TicketViewer) {
    const ticket = await this.findOne(id, clientId, viewer);
    const hours = Number(dto.hours);
    if (!(hours > 0)) throw new BadRequestException('Hours must be greater than zero');

    // The linked task is optional, but it has to be one of this ticket's — scoped
    // to the ticket so an id from another one can't be attached to these hours.
    const task = dto.taskId
      ? await this.prisma.ticketTask.findFirst({
          where: { id: dto.taskId, ticketId: id },
          select: { id: true, title: true },
        })
      : null;
    if (dto.taskId && !task) throw new NotFoundException('Task not found on this ticket');

    // Refuse hours that would break the customer's support-hours allowance before
    // anything is written (unless the pool allows excess). Throws on a violation.
    await this.customerProducts.assertHoursWithinAllowance(
      clientId, ticket.customerCompanyId, ticket.productId ?? null, hours, actorId,
    );

    return this.writeWorklog(clientId, ticket, {
      workerId: actorId,
      hours,
      workDate: dto.workDate ? new Date(dto.workDate) : new Date(),
      note: dto.note?.trim() || null,
      taskId: task?.id ?? null,
      taskTitle: task?.title ?? null,
    });
  }

  /**
   * Drop every hour booked against one task, reversing each from the support-hours
   * ledger, and report what was removed. Called when the task itself is deleted:
   * the hours go with the work they were logged against, and the customer's pool
   * is credited back.
   *
   * Deliberately not `onDelete: Cascade` on the FK — the database would delete the
   * rows without ever telling the ledger, silently leaving a `MONTHLY` pool
   * showing hours it no longer holds any entry for. The link stays `SetNull` so
   * any other path that removes a task keeps the entries (and their denormalised
   * `taskTitle`) rather than losing them unreversed; this method is the one door
   * that means "these hours were logged in error too".
   */
  async dropWorklogsForTask(ticketId: string, taskId: string, clientId: string, viewer: TicketViewer) {
    const ticket = await this.findOne(ticketId, clientId, viewer);
    const logs = await this.prisma.ticketWorklog.findMany({
      where: { ticketId, taskId },
      select: { id: true, hours: true },
    });
    let hours = 0;
    for (const wl of logs) {
      // Through `dropWorklog`, so the ledger reversal can never drift from the
      // one the time list's own delete performs.
      if (await this.dropWorklog(clientId, ticket, wl.id)) hours += Number(wl.hours);
    }
    return { count: logs.length, hours };
  }

  async deleteWorklog(id: string, worklogId: string, clientId: string, viewer: TicketViewer) {
    const ticket = await this.findOne(id, clientId, viewer);
    if (!(await this.dropWorklog(clientId, ticket, worklogId))) {
      throw new NotFoundException('Worklog not found');
    }
    return { message: 'Worklog removed' };
  }

}
