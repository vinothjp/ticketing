import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TemplatesService } from '../templates/templates.service';
import { ActivityService } from '../activity/activity.service';
import { MailerService } from '../mail/mailer.service';
import { ProductsService } from '../products/products.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';

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

    // Auto-route a customer ticket to the module's consultant (primary, or the
    // secondary when the primary already has an open ticket). "Others"/no module
    // stays unassigned for an admin to pick.
    let assignedConsultantId: string | null = null;
    if (isCustomerTicket && dto.productId && dto.moduleId && dto.consultantType) {
      const product = await this.prisma.product.findFirst({ where: { id: dto.productId, clientId } });
      if (product?.autoAssign) {
        assignedConsultantId = await this.products.resolveConsultant(
          clientId,
          dto.moduleId,
          dto.consultantType === 'TECHNICAL' ? 'TECHNICAL' : 'FUNCTIONAL',
        );
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
    const [product, module] = await Promise.all([
      ticket.productId ? this.prisma.product.findUnique({ where: { id: ticket.productId }, select: { name: true, code: true } }) : null,
      ticket.moduleId ? this.prisma.productModule.findUnique({ where: { id: ticket.moduleId }, select: { name: true } }) : null,
    ]);
    Object.assign(ticket, {
      productName: product?.name ?? null,
      productCode: product?.code ?? null,
      moduleName: module?.name ?? null,
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

    let closedDate = ticket.closedDate;
    if (
      dto.ticketStatus &&
      dto.ticketStatus !== ticket.ticketStatus &&
      !closedDate
    ) {
      const statusOption = await this.prisma.picklistOption.findFirst({
        where: { clientId, listKey: 'ticketStatus', value: dto.ticketStatus },
      });
      const label = (statusOption?.label ?? dto.ticketStatus).toLowerCase();
      if (label === 'closed') closedDate = new Date();
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
        closedDate,
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
        summary: `Status changed to ${dto.ticketStatus}`,
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

    const assignees = userIds.length
      ? (
          await this.prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { username: true },
          })
        )
          .map((u) => u.username)
          .join(', ')
      : 'nobody';
    await this.activity.log({
      ticketId: id,
      actorUserId: actorId,
      type: 'ASSIGNED',
      summary: `Assigned to ${assignees}`,
      meta: { userIds },
    });

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
    await this.findOne(id, clientId, viewer);
    const resolvedStatus = dto.ticketStatus || 'Resolved';
    const updated = await this.prisma.ticket.update({
      where: { id },
      data: {
        resolution: dto.resolution,
        resolvedAt: new Date(),
        resolvedById: actorId,
        ticketStatus: resolvedStatus,
        updatedBy: actorId,
      },
    });
    await this.activity.log({
      ticketId: id,
      actorUserId: actorId,
      type: 'RESOLVED',
      summary: 'Ticket resolved',
    });
    return updated;
  }

  async reopen(id: string, clientId: string, actorId: string, viewer: TicketViewer) {
    await this.findOne(id, clientId, viewer);
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
        ticketStatus: reopenStatus,
        reopenedCount: { increment: 1 },
        updatedBy: actorId,
      },
    });
    await this.activity.log({
      ticketId: id,
      actorUserId: actorId,
      type: 'REOPENED',
      summary: 'Ticket reopened',
    });
    return updated;
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
}
