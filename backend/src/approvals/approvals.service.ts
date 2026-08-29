import {
  Injectable, NotFoundException, ForbiddenException, BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TicketsService, TicketViewer } from '../tickets/tickets.service';
import { ActivityService } from '../activity/activity.service';
import { MailerService } from '../mail/mailer.service';
import { AssetAllocationsService } from '../assets/asset-allocations.service';
import { RequestApprovalDto, DecideApprovalDto, UpdateApprovalDto } from './dto/approval.dto';

/**
 * A ticket approval is an **asset request**. The row names the asset being asked
 * for; approving it issues that asset to whoever raised the request, as an
 * ISSUED `AssetAllocation` that shows up on their Employee Master screen.
 *
 * The asset is optional throughout — a request with no asset behaves exactly as
 * the plain sign-off this flow used to be, which is what keeps every approval
 * raised before this change working.
 */
@Injectable()
export class ApprovalsService {
  constructor(
    private prisma: PrismaService,
    private tickets: TicketsService,
    private activity: ActivityService,
    private mailer: MailerService,
    private allocations: AssetAllocationsService,
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
      select: { id: true, username: true, name: true, email: true },
    });
    if (!approver) throw new BadRequestException('Approver is not a user in your organization');
    const requester = await this.prisma.user.findUnique({
      where: { id: actor.id },
      select: { username: true, name: true },
    });

    // Refuse at request time as well as at approval time: asking for a laptop
    // that is already out with someone should fail while the requester is still
    // looking at the dialog, not sit pending until the approver hits the wall.
    const asset = await this.loadAsset(dto.assetId, clientId);
    if (asset) await this.allocations.assertAssetFree(asset.id, clientId);

    const approval = await this.prisma.ticketApproval.create({
      data: {
        ticketId,
        approverUserId: approver.id,
        approverName: approver.name || approver.username,
        status: 'PENDING',
        comment: dto.comment,
        requestedById: actor.id,
        requestedByName: requester?.name || requester?.username || null,
        assetId: asset?.id ?? null,
        assetCode: asset?.assetId ?? null,
        assetName: asset?.assetName ?? null,
        assetType: dto.assetType?.trim() || asset?.assetType || null,
      },
    });

    await this.activity.log({
      ticketId,
      actorUserId: actor.id,
      type: 'APPROVAL_REQUESTED',
      summary: asset
        ? `Asset ${asset.assetId} requested from ${approval.approverName}`
        : `Approval requested from ${approval.approverName}`,
    });

    // Best-effort email notification — fire-and-forget so a slow SMTP send never
    // blocks the response (which would freeze the "Request asset" dialog).
    const subject = asset
      ? `Asset request: ${asset.assetId} — ${asset.assetName}`
      : `Approval requested: ${ticket.subject}`;
    void this.mailer
      .sendMail({
        to: approver.email,
        subject: `[${ticket.ticketNumber}] ${subject}`,
        html:
          `<p>You have ${asset ? 'an asset request' : 'an approval request'} on ticket <b>${ticket.ticketNumber}</b> — ${ticket.subject}.</p>` +
          (asset ? `<p><b>Asset:</b> ${asset.assetId} — ${asset.assetName}</p>` : '') +
          (dto.comment ? `<p>${dto.comment}</p>` : '') +
          '<p>Open the ticket to approve or reject.</p>',
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
        select: { id: true, username: true, name: true },
      });
      if (!approver) throw new BadRequestException('Approver is not a user in your organization');
      approverName = approver.name || approver.username;
    }

    // Swapping the asset re-checks availability; an explicit null clears it and
    // turns the row back into a plain approval request.
    const swappingAsset = dto.assetId !== undefined && dto.assetId !== approval.assetId;
    const asset = swappingAsset ? await this.loadAsset(dto.assetId, clientId) : null;
    if (asset) await this.allocations.assertAssetFree(asset.id, clientId);

    const updated = await this.prisma.ticketApproval.update({
      where: { id: approvalId },
      data: {
        approverUserId: dto.approverUserId ?? approval.approverUserId,
        approverName,
        comment: dto.comment === undefined ? approval.comment : dto.comment || null,
        ...(swappingAsset
          ? { assetId: asset?.id ?? null, assetCode: asset?.assetId ?? null, assetName: asset?.assetName ?? null }
          : {}),
        ...(dto.assetType === undefined
          ? (swappingAsset ? { assetType: asset?.assetType ?? null } : {})
          : { assetType: dto.assetType?.trim() || null }),
      },
    });

    await this.activity.log({
      ticketId: approval.ticketId,
      actorUserId: actor.id,
      type: 'APPROVAL_UPDATED',
      summary: updated.assetCode
        ? `Asset request updated — ${updated.assetCode}, approver ${approverName ?? 'unknown'}`
        : `Approval request updated — approver ${approverName ?? 'unknown'}`,
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
      summary: approval.assetCode
        ? `Asset request for ${approval.assetCode} was withdrawn`
        : `Approval request to ${approval.approverName ?? 'approver'} was deleted`,
    });

    return { id: approvalId };
  }

  /**
   * Approving an asset request **issues the asset**, to the person who raised it.
   * Availability is re-checked here and not merely at request time: the asset may
   * have gone out to someone else while this sat pending, and the honest answer
   * then is to refuse the approval rather than hand one unit to two people.
   * Rejecting allocates nothing.
   */
  async decide(approvalId: string, clientId: string, dto: DecideApprovalDto, actorId: string) {
    const approval = await this.prisma.ticketApproval.findUnique({
      where: { id: approvalId },
      include: { ticket: { select: { id: true, clientId: true, ticketNumber: true } } },
    });
    if (!approval || approval.ticket.clientId !== clientId) throw new NotFoundException('Approval not found');
    if (approval.approverUserId !== actorId) throw new ForbiddenException('Only the named approver can decide this');
    if (approval.status !== 'PENDING') throw new BadRequestException('This approval has already been decided');

    const issuing = dto.status === 'APPROVED' && !!approval.assetId;
    if (issuing) {
      if (!approval.requestedById) {
        throw new BadRequestException('This asset request has no requester to issue the asset to');
      }
      // Assert before the status is written, so a refusal leaves the request
      // PENDING and still decidable once the asset comes back.
      await this.allocations.assertAssetFree(approval.assetId!, clientId);
    }

    const updated = await this.prisma.ticketApproval.update({
      where: { id: approvalId },
      data: { status: dto.status, comment: dto.comment ?? approval.comment, decidedAt: new Date() },
    });

    if (issuing) {
      await this.allocations.create(
        clientId,
        { assetId: approval.assetId!, employeeUserId: approval.requestedById!, status: 'ISSUED' },
        actorId,
      );
    }

    const outcome = dto.status === 'APPROVED' ? 'approved' : 'rejected';
    await this.activity.log({
      ticketId: approval.ticketId,
      actorUserId: actorId,
      type: 'APPROVAL_DECIDED',
      summary: approval.assetCode
        ? issuing
          ? `Asset ${approval.assetCode} approved and issued to ${approval.requestedByName ?? 'the requester'}`
          : `Asset request for ${approval.assetCode} ${outcome} by ${approval.approverName ?? 'approver'}`
        : `Approval ${outcome} by ${approval.approverName ?? 'approver'}`,
      meta: { status: dto.status },
    });

    return updated;
  }

  /** The requested asset, inside this tenant. A null/absent id means no asset. */
  private async loadAsset(assetId: string | null | undefined, clientId: string) {
    if (!assetId) return null;
    const asset = await this.prisma.asset.findFirst({
      where: { id: assetId, clientId },
      select: { id: true, assetId: true, assetName: true, assetType: true },
    });
    if (!asset) throw new BadRequestException('Asset is not in your organization');
    return asset;
  }
}
