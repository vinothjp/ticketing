import {
  Injectable, NotFoundException, ForbiddenException, BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TicketsService, TicketViewer } from '../tickets/tickets.service';
import { ActivityService } from '../activity/activity.service';
import { MailerService } from '../mail/mailer.service';
import { RequestApprovalDto, DecideApprovalDto } from './dto/approval.dto';

@Injectable()
export class ApprovalsService {
  constructor(
    private prisma: PrismaService,
    private tickets: TicketsService,
    private activity: ActivityService,
    private mailer: MailerService,
  ) {}

  list(ticketId: string, clientId: string, viewer: TicketViewer) {
    return this.tickets
      .findOne(ticketId, clientId, viewer)
      .then(() =>
        this.prisma.ticketApproval.findMany({ where: { ticketId }, orderBy: { requestedAt: 'desc' } }),
      );
  }

  async request(ticketId: string, clientId: string, dto: RequestApprovalDto, actor: { id: string }, viewer: TicketViewer) {
    const ticket = await this.tickets.findOne(ticketId, clientId, viewer);
    const approver = await this.prisma.user.findFirst({
      where: { id: dto.approverUserId, clientId },
      select: { id: true, username: true, email: true },
    });
    if (!approver) throw new BadRequestException('Approver is not a user in your organization');
    const requester = await this.prisma.user.findUnique({ where: { id: actor.id }, select: { username: true } });

    const approval = await this.prisma.ticketApproval.create({
      data: {
        ticketId,
        approverUserId: approver.id,
        approverName: approver.username,
        status: 'PENDING',
        comment: dto.comment,
        requestedById: actor.id,
        requestedByName: requester?.username ?? null,
      },
    });

    await this.activity.log({
      ticketId,
      actorUserId: actor.id,
      type: 'APPROVAL_REQUESTED',
      summary: `Approval requested from ${approver.username}`,
    });

    // Best-effort email notification — fire-and-forget so a slow SMTP send never
    // blocks the response (which would freeze the "Request approval" dialog).
    void this.mailer
      .sendMail({
        to: approver.email,
        subject: `[${ticket.ticketNumber}] Approval requested: ${ticket.subject}`,
        html: `<p>You have an approval request on ticket <b>${ticket.ticketNumber}</b> — ${ticket.subject}.</p>${dto.comment ? `<p>${dto.comment}</p>` : ''}<p>Open the ticket to approve or reject.</p>`,
      }, clientId)
      .catch(() => { /* notification is best-effort */ });

    return approval;
  }

  async decide(approvalId: string, clientId: string, dto: DecideApprovalDto, actorId: string) {
    const approval = await this.prisma.ticketApproval.findUnique({
      where: { id: approvalId },
      include: { ticket: { select: { id: true, clientId: true, ticketNumber: true } } },
    });
    if (!approval || approval.ticket.clientId !== clientId) throw new NotFoundException('Approval not found');
    if (approval.approverUserId !== actorId) throw new ForbiddenException('Only the named approver can decide this');
    if (approval.status !== 'PENDING') throw new BadRequestException('This approval has already been decided');

    const updated = await this.prisma.ticketApproval.update({
      where: { id: approvalId },
      data: { status: dto.status, comment: dto.comment ?? approval.comment, decidedAt: new Date() },
    });

    await this.activity.log({
      ticketId: approval.ticketId,
      actorUserId: actorId,
      type: 'APPROVAL_DECIDED',
      summary: `Approval ${dto.status === 'APPROVED' ? 'approved' : 'rejected'} by ${approval.approverName ?? 'approver'}`,
      meta: { status: dto.status },
    });

    return updated;
  }
}
