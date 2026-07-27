import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TemplatesService } from '../templates/templates.service';
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

@Injectable()
export class TicketsService {
  constructor(
    private prisma: PrismaService,
    private templatesService: TemplatesService,
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

    return ticket;
  }

  findAll(clientId: string) {
    return this.prisma.ticket.findMany({
      where: { clientId },
      orderBy: { createdAt: 'desc' },
      include: {
        template: { select: { id: true, name: true, category: true } },
        technicians: {
          include: { user: { select: { id: true, username: true } } },
        },
      },
    });
  }

  async findOne(id: string, clientId: string) {
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
    return ticket;
  }

  async update(
    id: string,
    clientId: string,
    dto: UpdateTicketDto,
    actorId: string,
  ) {
    const ticket = await this.findOne(id, clientId);

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

    return this.prisma.ticket.update({
      where: { id },
      data: {
        ticketStatus: dto.ticketStatus,
        priority: dto.priority,
        ticketCategory: dto.ticketCategory,
        subCategory: dto.subCategory,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        expectedResolutionDate: dto.expectedResolutionDate
          ? new Date(dto.expectedResolutionDate)
          : undefined,
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
  }

  async assignTechnicians(
    id: string,
    clientId: string,
    userIds: string[],
    actorId: string,
  ) {
    await this.findOne(id, clientId);

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

    return this.findOne(id, clientId);
  }

  async addAttachments(
    id: string,
    clientId: string,
    files: Express.Multer.File[],
    actorId: string,
  ) {
    await this.findOne(id, clientId);
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
