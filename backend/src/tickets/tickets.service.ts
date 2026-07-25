import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
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
  customerConfirmation: 'customerConfirmation',
  subject: 'subject',
  description: 'description',
  rootCauseCategory: 'rootCauseCategory',
  rootCauseDescription: 'rootCauseDescription',
  correctionAction: 'correctionAction',
  preventionAction: 'preventionAction',
  lessonsLearned: 'lessonsLearned',
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
    const template = await this.templatesService.getByRequestType(
      dto.requestTypeId,
      clientId,
    );

    // Server-side is the source of truth for "required" — it's tenant-configured
    // data, so the client's zod validation alone can't be trusted.
    const missing: string[] = [];
    for (const field of template.fields) {
      if (
        field.systemManaged ||
        field.visibility !== 'VISIBLE' ||
        field.requirement !== 'MANDATORY'
      )
        continue;
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
          requestTypeId: dto.requestTypeId,
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
          dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
          expectedResolutionDate: dto.expectedResolutionDate
            ? new Date(dto.expectedResolutionDate)
            : undefined,
          customerConfirmation: dto.customerConfirmation,
          subject: dto.subject ?? '',
          description: dto.description ?? '',
          rootCauseCategory: dto.rootCauseCategory,
          rootCauseDescription: dto.rootCauseDescription,
          correctionAction: dto.correctionAction,
          preventionAction: dto.preventionAction,
          lessonsLearned: dto.lessonsLearned,
          createdBy: actorId,
          updatedBy: actorId,
          technicians: dto.technicianUserIds?.length
            ? { create: dto.technicianUserIds.map((userId) => ({ userId })) }
            : undefined,
        },
        include: { technicians: true, requestType: true },
      });
    });

    return ticket;
  }

  findAll(clientId: string) {
    return this.prisma.ticket.findMany({
      where: { clientId },
      orderBy: { createdAt: 'desc' },
      include: {
        requestType: { select: { name: true } },
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
        requestType: true,
        template: true,
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
        customerConfirmation: dto.customerConfirmation,
        closedDate,
        rootCauseCategory: dto.rootCauseCategory,
        rootCauseDescription: dto.rootCauseDescription,
        correctionAction: dto.correctionAction,
        preventionAction: dto.preventionAction,
        lessonsLearned: dto.lessonsLearned,
        updatedBy: actorId,
      },
      include: {
        requestType: true,
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
