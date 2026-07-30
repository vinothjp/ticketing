import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TemplatesService } from '../templates/templates.service';
import { ActivityService } from '../activity/activity.service';
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
export type TicketViewer = { id: string; roles: string[] };
const isAdmin = (viewer: TicketViewer) => viewer.roles.includes('Admin');

@Injectable()
export class TicketsService {
  constructor(
    private prisma: PrismaService,
    private templatesService: TemplatesService,
    private activity: ActivityService,
  ) {}

  async create(dto: CreateTicketDto, clientId: string, actorId: string) {
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
          requestorName: dto.requestorName,
          requestorEmail: dto.requestorEmail,
          customerName: dto.customerName,
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
    return ticket;
  }

  findAll(clientId: string, viewer: TicketViewer) {
    return this.prisma.ticket.findMany({
      // Non-admins see tickets assigned to them, plus any they've been asked to approve.
      where: {
        clientId,
        ...(isAdmin(viewer)
          ? {}
          : {
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
      },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
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
    await this.findOne(id, clientId, viewer);

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
