import {
  Injectable, NotFoundException, ForbiddenException, BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TicketsService, TicketViewer } from '../tickets/tickets.service';
import { ActivityService } from '../activity/activity.service';
import { MailerService } from '../mail/mailer.service';
import { RequestApprovalDto, DecideApprovalDto, UpdateApprovalDto } from './dto/approval.dto';

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

  /**
   * Editing or withdrawing an approval request is the *requesting* side of the
   * flow, so it is gated on who owns the ticket's work — a tenant Admin or the
   * agent the ticket is assigned to. The named approver decides; they do not
   * get to rewrite or delete the request made of them.
   */
  private async loadManageable(approvalId: string, clientId: string, actor: { id: string; roles: string[] }) {
    const approval = await this.prisma.ticketApproval.findUnique({
      where: { id: approvalId },
      include: {
        ticket: {
          select: { id: true, clientId: true, technicians: { select: { userId: true } } },
        },
      },
    });
    if (!approval || approval.ticket.clientId !== clientId) throw new NotFoundException('Approval not found');
    const mayManage =
      actor.roles.includes('Admin') || approval.ticket.technicians.some((t) => t.userId === actor.id);
    if (!mayManage) {
      throw new ForbiddenException('Only an admin or the assigned agent can change this approval request');
    }
    return approval;
  }

  async update(approvalId: string, clientId: string, dto: UpdateApprovalDto, actor: { id: string; roles: string[] }) {
    const approval = await this.loadManageable(approvalId, clientId, actor);
    if (approval.status !== 'PENDING') throw new BadRequestException('This approval has already been decided');

    let approverName = approval.approverName;
    if (dto.approverUserId && dto.approverUserId !== approval.approverUserId) {
      const approver = await this.prisma.user.findFirst({
        where: { id: dto.approverUserId, clientId },
        select: { id: true, username: true },
      });
      if (!approver) throw new BadRequestException('Approver is not a user in your organization');
      approverName = approver.username;
    }

    const updated = await this.prisma.ticketApproval.update({
      where: { id: approvalId },
      data: {
        approverUserId: dto.approverUserId ?? approval.approverUserId,
        approverName,
        comment: dto.comment === undefined ? approval.comment : dto.comment || null,
      },
    });

    await this.activity.log({
      ticketId: approval.ticketId,
      actorUserId: actor.id,
      type: 'APPROVAL_UPDATED',
      summary: `Approval request updated — approver ${approverName ?? 'unknown'}`,
    });

    return updated;
  }

  async remove(approvalId: string, clientId: string, actor: { id: string; roles: string[] }) {
    const approval = await this.loadManageable(approvalId, clientId, actor);
    await this.prisma.ticketApproval.delete({ where: { id: approvalId } });

    await this.activity.log({
      ticketId: approval.ticketId,
      actorUserId: actor.id,
      type: 'APPROVAL_CANCELLED',
      summary: `Approval request to ${approval.approverName ?? 'approver'} was deleted`,
    });

    return { id: approvalId };
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
