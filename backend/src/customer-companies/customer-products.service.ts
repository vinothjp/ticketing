import { Injectable, NotFoundException, ConflictException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { CustomerCompanyProduct, CustomerCompany, Prisma } from '@prisma/client';
import { unlink } from 'fs/promises';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from '../mail/mailer.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  AssignProductDto, UpdateProductTermsDto, RenewAmcDto, CreateProductRequestDto, GrantRequestDto, SetContractDto,
  RenewContractDto, AddCustomerConsultantDto,
} from './dto/customer-product.dto';

const DAY = 86_400_000;
/**
 * How many days before coverage ends the client is warned. Measured in days
 * left, not percent elapsed — a 30-day heads-up is the same promise on a
 * one-year AMC and on a three-month one.
 */
const EXPIRY_ALERT_DAYS = 30;
const daysLeft = (end: Date) => Math.ceil((end.getTime() - Date.now()) / DAY);
const monthsAfter = (d: Date, months: number) => {
  const r = new Date(d);
  r.setMonth(r.getMonth() + months);
  return r;
};
// Rough whole-month span between two dates, for the display "months" fields.
const monthsBetween = (start: Date, end: Date) =>
  Math.max(1, Math.round((end.getTime() - start.getTime()) / (30.44 * DAY)));

/** One `TicketWorklog` entry, reduced to what the pool maths needs. */
type LoggedHour = { hours: number; at: Date };

@Injectable()
export class CustomerProductsService {
  constructor(
    private prisma: PrismaService,
    private mailer: MailerService,
    private notifications: NotificationsService,
  ) {}

  // ---- coverage maths --------------------------------------------------------

  /** Reject invalid / inverted coverage windows before they hit the DB. */
  private assertRange(start: Date, end: Date) {
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()))
      throw new BadRequestException('Invalid start or end date');
    if (end.getTime() <= start.getTime())
      throw new BadRequestException('End date must be after the start date');
  }

  /**
   * Resolve a Unlimited / Limited support-hours choice into what the DB stores.
   * Unlimited is the explicit "no cap" state — the allocation is cleared so no
   * pool maths, deduction or "running low" alert ever applies to it. Limited must
   * carry a real allocation, so a missing or zero figure is rejected.
   */
  private resolveHoursPool(
    unlimitedFlag: boolean | undefined,
    hours: number | undefined,
    currentUnlimited: boolean,
    currentHours: number | null,
  ): { unlimited: boolean; hours: number | null } {
    const unlimited = unlimitedFlag ?? currentUnlimited;
    if (unlimited) return { unlimited: true, hours: null };
    const value = hours ?? currentHours;
    if (value == null || value <= 0)
      throw new BadRequestException('Support hours must be greater than zero, or set to unlimited');
    return { unlimited: false, hours: value };
  }

  private pctElapsed(start?: Date | null, end?: Date | null): number {
    if (!start || !end) return 0;
    const total = end.getTime() - start.getTime();
    if (total <= 0) return 100;
    return Math.max(0, Math.min(100, Math.round(((Date.now() - start.getTime()) / total) * 100)));
  }
  private daysLeft(end?: Date | null): number | null {
    if (!end) return null;
    return Math.ceil((end.getTime() - Date.now()) / DAY);
  }
  /** A human "X mo Y d" countdown to a date. */
  private timeLeft(end?: Date | null): { days: number | null; label: string } {
    if (!end) return { days: null, label: '—' };
    const days = Math.ceil((end.getTime() - Date.now()) / DAY);
    if (days <= 0) return { days, label: 'Ended' };
    const months = Math.floor(days / 30);
    const rem = days % 30;
    return { days, label: months > 0 ? `${months} mo ${rem} d` : `${days} d` };
  }

  // ---- monthly support-hours ledger + excess config -------------------------

  /** "YYYY-MM" for the month a date falls in. */
  private periodLabel(at: Date = new Date()) {
    return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}`;
  }
  /** Midnight on the first of a date's calendar month. */
  private monthStart(at: Date = new Date()) {
    return new Date(at.getFullYear(), at.getMonth(), 1);
  }

  /**
   * The support-hours pool that actually governs a (company, product): the shared
   * customer contract when the customer is on CUSTOMER scope, otherwise the named
   * product's active (paid/free) pool. `hours` is read per the pool's period —
   * a per-month allowance under MONTHLY, a whole-term one under FULL_AMC. Returns
   * null when nothing governs (unknown company/product). Carries the excess config.
   */
  private async resolvePoolConfig(clientId: string, companyId: string, productId: string | null) {
    const company = await this.prisma.customerCompany.findFirst({ where: { id: companyId, clientId } });
    if (!company) return null;
    if (company.contractScope === 'CUSTOMER') {
      return {
        scope: 'CONTRACT' as const, ownerId: company.id, clientId,
        period: company.contractHoursPeriod, unlimited: company.contractHoursUnlimited, hours: company.contractHours,
        carryForward: company.contractCarryForward, allowExcess: company.contractAllowExcess,
        excessApproval: company.contractExcessApproval, excessApproverId: company.contractExcessApproverId,
        allowTicketsAfterHours: company.contractAllowTicketsAfterHours,
      };
    }
    if (!productId) return null;
    const cp = await this.prisma.customerCompanyProduct.findFirst({ where: { customerCompanyId: companyId, productId } });
    if (!cp) return null;
    const paid = cp.amcType === 'PAID';
    return {
      scope: 'PRODUCT' as const, ownerId: cp.id, clientId,
      period: cp.amcHoursPeriod, unlimited: paid ? cp.paidAmcHoursUnlimited : cp.freeAmcHoursUnlimited,
      hours: paid ? cp.paidAmcHours : cp.freeAmcHours,
      carryForward: cp.amcCarryForward, allowExcess: cp.amcAllowExcess,
      excessApproval: cp.amcExcessApproval, excessApproverId: cp.amcExcessApproverId,
      allowTicketsAfterHours: cp.amcAllowTicketsAfterHours,
    };
  }

  /**
   * The ledger row for a pool's month, created on first touch. `carriedIn` is the
   * previous month's unused balance when carry-forward is on, else zero — so the
   * row is a self-contained snapshot the sweep and the views can both read.
   */
  private async ledgerRowFor(
    scope: 'CONTRACT' | 'PRODUCT', ownerId: string, clientId: string,
    allocated: number, carryForward: boolean, at: Date = new Date(),
  ) {
    const periodLabel = this.periodLabel(at);
    const found = await this.prisma.supportHoursLedger.findUnique({
      where: { scope_ownerId_periodLabel: { scope, ownerId, periodLabel } },
    });
    if (found) return found;
    let carriedIn = 0;
    if (carryForward) {
      const prevLabel = this.periodLabel(new Date(at.getFullYear(), at.getMonth() - 1, 1));
      const prev = await this.prisma.supportHoursLedger.findUnique({
        where: { scope_ownerId_periodLabel: { scope, ownerId, periodLabel: prevLabel } },
      });
      if (prev) carriedIn = Math.max(0, prev.allocated + prev.carriedIn - Number(prev.used));
    }
    return this.prisma.supportHoursLedger.create({
      data: { clientId, scope, ownerId, periodStart: this.monthStart(at), periodLabel, allocated, carriedIn },
    });
  }

  /** Current-month allocated / carried-in / used / available for a MONTHLY pool. */
  private async monthlyAvailability(p: {
    scope: 'CONTRACT' | 'PRODUCT'; ownerId: string; clientId: string; hours: number; carryForward: boolean;
  }) {
    const row = await this.ledgerRowFor(p.scope, p.ownerId, p.clientId, p.hours, p.carryForward);
    const used = Number(row.used);
    return { allocated: row.allocated, carriedIn: row.carriedIn, used, available: row.allocated + row.carriedIn - used };
  }

  /** Keep the current month's allocation in step with an edited MONTHLY figure. */
  private async refreshLedgerAllocation(
    scope: 'CONTRACT' | 'PRODUCT', ownerId: string, clientId: string, allocated: number, carryForward: boolean,
  ) {
    const row = await this.ledgerRowFor(scope, ownerId, clientId, allocated, carryForward);
    if (row.allocated !== allocated) {
      await this.prisma.supportHoursLedger.update({ where: { id: row.id }, data: { allocated } });
    }
  }

  /** A renewal starts a clean month: allocation reset, nothing carried or used. */
  private async resetLedgerForRenewal(
    scope: 'CONTRACT' | 'PRODUCT', ownerId: string, clientId: string, allocated: number,
  ) {
    const periodLabel = this.periodLabel();
    await this.prisma.supportHoursLedger.upsert({
      where: { scope_ownerId_periodLabel: { scope, ownerId, periodLabel } },
      update: { allocated, carriedIn: 0, used: 0 },
      create: { clientId, scope, ownerId, periodStart: this.monthStart(), periodLabel, allocated, carriedIn: 0 },
    });
  }

  /** Build the `support` view block (config + MONTHLY availability) shared by both scopes. */
  private async buildSupportView(cfg: {
    scope: 'CONTRACT' | 'PRODUCT'; ownerId: string; clientId: string;
    period: string; unlimited: boolean; hours: number | null;
    carryForward: boolean; allowExcess: boolean; excessApproval: boolean; excessApproverId: string | null;
    allowTicketsAfterHours: boolean;
  }) {
    const approver = cfg.excessApproverId
      ? await this.prisma.user.findUnique({ where: { id: cfg.excessApproverId }, select: { username: true } })
      : null;
    const base = {
      period: cfg.period, carryForward: cfg.carryForward,
      allowExcess: cfg.allowExcess, excessApproval: cfg.excessApproval,
      allowTicketsAfterHours: cfg.allowTicketsAfterHours,
      approverId: cfg.excessApproverId, approverName: approver?.username ?? null,
    };
    if (cfg.period !== 'MONTHLY' || cfg.unlimited || cfg.hours == null) {
      return { ...base, currentAllocated: null, carriedIn: 0, currentUsed: 0, available: null };
    }
    const m = await this.monthlyAvailability({ ...cfg, hours: cfg.hours });
    return { ...base, currentAllocated: m.allocated, carriedIn: m.carriedIn, currentUsed: m.used, available: m.available };
  }

  // ---- Excess-hours approvals -------------------------------------------

  /**
   * Every excess request raised for a client, newest first. Shown on the client's
   * Products & consultants screens, where the approver decides them.
   */
  listExcessRequests(clientId: string, companyId: string) {
    return this.prisma.supportHoursExcessRequest.findMany({
      where: { clientId, customerCompanyId: companyId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Open requests this user is the named approver on, across every client. */
  myPendingExcessRequests(clientId: string, userId: string) {
    return this.prisma.supportHoursExcessRequest.findMany({
      where: { clientId, approverUserId: userId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      include: { company: { select: { name: true } } },
    });
  }

  /**
   * Approve or decline an excess request. Only the **named approver** decides it,
   * with a tenant Admin able to step in — an agent who merely happens to see the
   * client screen must not be able to sign off someone else's approval.
   *
   * Approving unlocks over-cap logging on that pool for the period; it books no
   * hours. Either way the consultant who asked is notified, since they are
   * blocked until this lands.
   */
  async decideExcessRequest(
    reqId: string,
    clientId: string,
    viewer: { id: string; roles: string[] },
    approve: boolean,
    note?: string,
  ) {
    const request = await this.prisma.supportHoursExcessRequest.findFirst({
      where: { id: reqId, clientId },
      include: { company: { select: { name: true } } },
    });
    if (!request) throw new NotFoundException('Request not found');
    const isAdmin = viewer.roles.includes('Admin');
    if (!isAdmin && request.approverUserId !== viewer.id) {
      throw new ForbiddenException('Only the named approver can decide this request');
    }
    if (request.status !== 'PENDING') {
      throw new BadRequestException(`This request has already been ${request.status.toLowerCase()}`);
    }

    const decider = await this.prisma.user.findUnique({
      where: { id: viewer.id }, select: { username: true },
    });
    const updated = await this.prisma.supportHoursExcessRequest.update({
      where: { id: reqId },
      data: {
        status: approve ? 'APPROVED' : 'REJECTED',
        decisionNote: note?.trim() || null,
        decidedAt: new Date(),
        // Stamp who actually decided — an Admin stepping in is part of the record.
        approverUserId: request.approverUserId ?? viewer.id,
        approverName: decider?.username ?? request.approverName,
      },
    });
    if (request.requestedById) {
      await this.notifications.notify({
        clientId,
        userId: request.requestedById,
        type: 'SUPPORT_HOURS_EXCESS',
        title: approve ? 'Excess support hours approved' : 'Excess support hours declined',
        body: approve
          ? `${decider?.username ?? 'The approver'} approved logging beyond the ${request.allocated}h allowance for ${request.company?.name ?? 'the client'} — you can log your time now.`
          : `${decider?.username ?? 'The approver'} declined logging beyond the ${request.allocated}h allowance for ${request.company?.name ?? 'the client'}.${note?.trim() ? ` Reason: ${note.trim()}` : ''}`,
        link: request.scope === 'PRODUCT'
          ? `/admin/clients/${request.customerCompanyId}/products/${request.ownerId}`
          : `/admin/clients/${request.customerCompanyId}`,
      });
    }
    return updated;
  }

  /** A support-hours approver must be an internal staff user of the tenant. */
  private async assertStaffUser(userId: string, clientId: string) {
    const u = await this.prisma.user.findFirst({ where: { id: userId, clientId, customerCompanyId: null } });
    if (!u) throw new BadRequestException('The approver must be an internal staff user of this tenant');
  }

  /**
   * Ping the configured approver that a client has hit its support-hours cap.
   *
   * The link matters: the approver may be a consultant who would otherwise have
   * to hunt for the client, so the bell opens the exact screen carrying the
   * Approve/Reject controls for that pool.
   */
  private async notifyExcessApprover(
    cfg: { clientId: string; excessApproverId: string | null; scope?: 'CONTRACT' | 'PRODUCT'; ownerId?: string },
    companyId: string,
    cap: number,
    /** Overrides the default "allowance reached" wording — a request raised when
     *  the approver was named has not reached anything yet. */
    body?: string,
  ) {
    if (!cfg.excessApproverId) return;
    const company = await this.prisma.customerCompany.findUnique({ where: { id: companyId }, select: { name: true } });
    await this.notifications.notify({
      clientId: cfg.clientId, userId: cfg.excessApproverId, type: 'SUPPORT_HOURS_EXCESS',
      title: 'Excess support-hours approval needed',
      body: body
        ?? `${company?.name ?? 'A client'} has reached its ${cap}h support-hours allowance — a request to log beyond it needs your approval.`,
      link: cfg.scope === 'PRODUCT' && cfg.ownerId
        ? `/admin/clients/${companyId}/products/${cfg.ownerId}`
        : `/admin/clients/${companyId}`,
    });
  }

  /**
   * Enforce the support-hours allowance before time is logged. Within the pool →
   * allowed. Over it → refused unless the pool allows excess; if excess needs
   * approval, the over-cap log is refused and the approver is notified. Unlimited
   * or unmapped pools are never capped. Public so the ticket-worklog path can call it.
   */
  async assertHoursWithinAllowance(
    clientId: string, companyId: string | null | undefined, productId: string | null | undefined, addHours: number,
    actorId?: string,
  ) {
    if (!companyId || !(addHours > 0)) return;
    const cfg = await this.resolvePoolConfig(clientId, companyId, productId ?? null);
    if (!cfg) return;
    const pool = await this.productSupportHours(clientId, companyId, productId ?? '');
    if (!pool.hasPool || pool.allocated == null) return; // unlimited / unmapped — no cap
    if (pool.used + addHours <= pool.allocated) return;  // within allowance
    if (!cfg.allowExcess) {
      throw new BadRequestException('Support-hours allowance exhausted — enable excess hours to log more time.');
    }
    if (cfg.excessApproval) {
      await this.assertExcessApproved(cfg, companyId, pool.allocated, pool.used, productId ?? null, actorId);
    }
  }

  /**
   * Naming an approver IS the request. The moment a pool is saved with Limited
   * hours, excess logging on, approval required and an approver named, a PENDING
   * request is raised for that pool's current period and the approver notified —
   * so the pool's own screen shows "Waiting for <approver>" straight away, and
   * turns into "Approved by …" / "Declined by …" once they decide, instead of
   * staying blank until some consultant happens to hit the cap.
   *
   * Scope-blind on purpose: it reads `resolvePoolConfig`, so a shared customer
   * contract and a per-product AMC behave identically — the rule is the same
   * wherever the Limited hours are configured.
   *
   * Idempotent, and driven entirely by the saved config:
   *  - config incomplete (Unlimited pool, excess off, approval off, no approver)
   *    → a PENDING row is withdrawn, since nothing is being asked any more. A
   *    decided row is left alone: it is a record, not a pending question.
   *  - a PENDING row already there → re-targeted if the approver changed, and
   *    the new approver notified; otherwise left as it is, so re-saving the
   *    same settings does not spam anyone.
   *  - already APPROVED/REJECTED for this period → left alone. Only a new period
   *    (a MONTHLY pool rolling over) asks again.
   */
  private async ensureExcessApprovalRequest(
    clientId: string,
    companyId: string,
    productId: string | null,
    actorId?: string,
  ) {
    const cfg = await this.resolvePoolConfig(clientId, companyId, productId);
    if (!cfg) return;
    const periodLabel = this.excessPeriodLabel(cfg.period);
    // Flipping a pool between "for the whole AMC" and "per month" changes which
    // period governs, stranding the other one's open question — it could never be
    // answered usefully but would sit in the approver's queue forever. Decided
    // rows stay: they record a decision that was genuinely made at the time.
    await this.prisma.supportHoursExcessRequest.deleteMany({
      where: {
        scope: cfg.scope, ownerId: cfg.ownerId, status: 'PENDING',
        periodLabel: { not: periodLabel },
      },
    });
    const existing = await this.prisma.supportHoursExcessRequest.findUnique({
      where: { scope_ownerId_periodLabel: { scope: cfg.scope, ownerId: cfg.ownerId, periodLabel } },
    });

    // An Unlimited pool has no allowance to exceed, so there is nothing to ask.
    // The permission is only as live as the config that asked for it. Turning
    // excess off, or moving the pool to Unlimited, retires the question — and a
    // decided row is retired with it, or toggling the setting off and on again
    // would silently re-activate an old approval nobody re-asked for.
    const wanted = !cfg.unlimited && cfg.allowExcess && cfg.excessApproval && !!cfg.excessApproverId;
    if (!wanted) {
      if (existing) await this.prisma.supportHoursExcessRequest.delete({ where: { id: existing.id } });
      return;
    }
    // Same question, same person — nothing to do, so re-saving the settings
    // never duplicates a row or re-notifies anyone.
    if (existing && existing.approverUserId === cfg.excessApproverId) return;
    // The approver changed. A still-open question is simply re-addressed; one
    // already decided is dropped and asked afresh, because the new approver has
    // agreed to nothing and the old decision was theirs to give, not to inherit.
    if (existing && existing.status !== 'PENDING') {
      await this.prisma.supportHoursExcessRequest.delete({ where: { id: existing.id } });
    }

    const company = await this.prisma.customerCompany.findUnique({
      where: { id: companyId }, select: { name: true },
    });
    const [approver, product] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: cfg.excessApproverId! }, select: { username: true } }),
      productId ? this.prisma.product.findUnique({ where: { id: productId }, select: { name: true } }) : null,
    ]);
    const cap = Number(cfg.hours ?? 0);
    const notifyBody =
      `${company?.name ?? 'A client'} has ${cap}h of support hours` +
      `${product?.name ? ` on ${product.name}` : ''} and needs your approval before time can be logged beyond it.`;

    if (existing?.status === 'PENDING') {
      await this.prisma.supportHoursExcessRequest.update({
        where: { id: existing.id },
        data: { approverUserId: cfg.excessApproverId, approverName: approver?.username ?? null },
      });
      await this.notifyExcessApprover(cfg, companyId, cap, notifyBody);
      return;
    }

    const pool = await this.productSupportHours(clientId, companyId, productId ?? '');
    const requester = actorId
      ? await this.prisma.user.findUnique({ where: { id: actorId }, select: { username: true } })
      : null;
    await this.prisma.supportHoursExcessRequest.create({
      data: {
        clientId, customerCompanyId: companyId,
        scope: cfg.scope, ownerId: cfg.ownerId, periodLabel,
        allocated: cap,
        // Where the pool stood when the approval was asked for.
        usedAtRequest: pool.used ?? 0,
        productName: product?.name ?? null,
        requestedById: actorId ?? null,
        requestedByName: requester?.username ?? null,
        approverUserId: cfg.excessApproverId,
        approverName: approver?.username ?? null,
      },
    });
    await this.notifyExcessApprover(cfg, companyId, cap, notifyBody);
  }

  /**
   * The period an excess approval belongs to. A MONTHLY pool gets a fresh
   * allowance every calendar month, so it must be re-approved each month rather
   * than riding an approval given in January; a whole-term pool has one window,
   * so it uses the 'ALL' sentinel (not null — Postgres would treat every NULL as
   * distinct and the unique index would stop catching duplicates).
   */
  private excessPeriodLabel(period: string) {
    return period === 'MONTHLY' ? this.periodLabel() : 'ALL';
  }

  /**
   * Over-cap logging on an approval-gated pool: allowed only once the named
   * approver has signed off for this pool and period. Anything else raises or
   * reuses a PENDING request and refuses, so the consultant is told where the
   * decision sits rather than just being blocked.
   *
   * The request is a **permission, not a time entry** — approving unlocks the
   * pool and the consultant then logs their hours normally. Nothing is booked on
   * their behalf, so nothing is booked without them seeing the final figure.
   */
  private async assertExcessApproved(
    cfg: {
      clientId: string; scope: 'CONTRACT' | 'PRODUCT'; ownerId: string;
      period: string; excessApproverId: string | null;
    },
    companyId: string,
    allocated: number,
    used: number,
    productId: string | null,
    actorId?: string,
  ) {
    const periodLabel = this.excessPeriodLabel(cfg.period);
    const existing = await this.prisma.supportHoursExcessRequest.findUnique({
      where: {
        scope_ownerId_periodLabel: { scope: cfg.scope, ownerId: cfg.ownerId, periodLabel },
      },
    });
    if (existing?.status === 'APPROVED') return;
    if (existing?.status === 'PENDING') {
      throw new BadRequestException(
        `Logging beyond the allowance is awaiting sign-off from ${existing.approverName ?? 'the approver'}.`,
      );
    }
    if (existing?.status === 'REJECTED') {
      throw new BadRequestException(
        existing.decisionNote
          ? `Logging beyond the allowance was declined: ${existing.decisionNote}`
          : 'Logging beyond the allowance was declined by the approver.',
      );
    }

    const [approver, product, requester] = await Promise.all([
      cfg.excessApproverId
        ? this.prisma.user.findUnique({ where: { id: cfg.excessApproverId }, select: { username: true } })
        : null,
      productId
        ? this.prisma.product.findUnique({ where: { id: productId }, select: { name: true } })
        : null,
      actorId
        ? this.prisma.user.findUnique({ where: { id: actorId }, select: { username: true } })
        : null,
    ]);
    await this.prisma.supportHoursExcessRequest.create({
      data: {
        clientId: cfg.clientId,
        customerCompanyId: companyId,
        scope: cfg.scope,
        ownerId: cfg.ownerId,
        periodLabel,
        allocated,
        // The position as it stood when the request was raised, so the approver
        // decides on the figures they were shown even if more time lands later.
        usedAtRequest: used,
        productName: product?.name ?? null,
        requestedById: actorId ?? null,
        requestedByName: requester?.username ?? null,
        approverUserId: cfg.excessApproverId,
        approverName: approver?.username ?? null,
      },
    });
    await this.notifyExcessApprover(cfg, companyId, allocated);
    throw new BadRequestException(
      `Support-hours allowance exhausted — a request has been sent to ${approver?.username ?? 'the approver'} for sign-off.`,
    );
  }

  /**
   * Gate a customer raising a new ticket on their support-hours pool. Refused
   * only when the pool is genuinely spent AND the tenant has turned
   * `allowTicketsAfterHours` off for whichever pool governs (the shared contract,
   * or the named product's own coverage). Unlimited and unmapped pools never
   * block, and neither does a pool with hours left. Staff-raised tickets don't
   * come through here — the setting is about the client's own self-service door.
   */
  async assertMayRaiseTicket(
    clientId: string, companyId: string | null | undefined, productId: string | null | undefined,
  ) {
    if (!companyId) return;
    const cfg = await this.resolvePoolConfig(clientId, companyId, productId ?? null);
    if (!cfg || cfg.allowTicketsAfterHours) return;
    const pool = await this.productSupportHours(clientId, companyId, productId ?? '');
    if (!pool.hasPool || pool.allocated == null) return; // unlimited / unmapped — no cap
    if (pool.used < pool.allocated) return;              // hours still left
    throw new BadRequestException(
      'Your support-hours allowance is exhausted — new tickets are not accepted until it is renewed. Please contact your support provider.',
    );
  }

  /**
   * Move a MONTHLY pool's ledger by `delta` hours for the month of `at` (positive
   * on a new worklog, negative on delete). No-op for FULL_AMC / unlimited pools,
   * whose usage the on-read aggregation already tracks. Public for the worklog path.
   */
  async adjustLoggedHours(
    clientId: string, companyId: string | null | undefined, productId: string | null | undefined,
    deltaHours: number, at: Date,
  ) {
    if (!companyId || !deltaHours) return;
    const cfg = await this.resolvePoolConfig(clientId, companyId, productId ?? null);
    if (!cfg || cfg.period !== 'MONTHLY' || cfg.unlimited || cfg.hours == null) return;
    const row = await this.ledgerRowFor(cfg.scope, cfg.ownerId, cfg.clientId, cfg.hours, cfg.carryForward, at);
    await this.prisma.supportHoursLedger.update({ where: { id: row.id }, data: { used: { increment: deltaHours } } });
  }

  /** Customer-facing view: warranty + AMC countdowns, live hours/visits left, agents. */
  private async toView(
    cp: CustomerCompanyProduct & { product?: { name: string; code: string } | null },
    clientId: string,
    agents: string[] = [],
    ticketHours = 0,
    // Consultants read these screens too (read-only, to decide excess-hours
    // approvals). What a client pays is not theirs to see, so the figure is
    // withheld here rather than only hidden in the UI.
    hideMoney = false,
  ) {
    const now = Date.now();
    const paid = cp.amcType === 'PAID';
    // Active pool = paid allocation once subscribed, else the free-period allocation.
    // Unlimited coverage has no allocation at all — nothing to spend down.
    const hoursUnlimited = paid ? cp.paidAmcHoursUnlimited : cp.freeAmcHoursUnlimited;
    const allocHours = hoursUnlimited ? null : paid ? cp.paidAmcHours : cp.freeAmcHours;
    const allocVisits = paid ? cp.paidAmcVisits : cp.freeAmcVisits;
    // Two things consume the pool: usage logged straight against the pool
    // (`hoursUsed`) and time consultants log on the customer's tickets for this
    // product. Both are shown together as one "hours spent" figure. Client visits
    // deliberately draw down only the visit count, never these hours.
    const loggedHours = Number(cp.hoursUsed);
    const hoursUsed = loggedHours + ticketHours;
    const warranty = this.timeLeft(cp.warrantyEnd);
    const amc = this.timeLeft(cp.amcEnd);
    return {
      id: cp.id,
      productId: cp.productId,
      productName: cp.product?.name ?? null,
      productCode: cp.product?.code ?? null,
      status: cp.status,
      purchaseDate: cp.purchaseDate,
      agents,
      warranty: {
        months: cp.warrantyMonths,
        end: cp.warrantyEnd,
        daysLeft: warranty.days,
        label: warranty.label,
        pct: this.pctElapsed(cp.purchaseDate, cp.warrantyEnd),
        active: cp.warrantyEnd ? cp.warrantyEnd.getTime() > now : false,
      },
      amc: {
        type: cp.amcType,
        start: cp.amcStart,
        end: cp.amcEnd,
        daysLeft: amc.days,
        label: amc.label,
        pct: this.pctElapsed(cp.amcStart, cp.amcEnd),
        active: cp.amcEnd ? cp.amcEnd.getTime() > now : false,
        freeMonths: cp.freeAmcMonths,
      },
      // Live support-hours + visits for the current period.
      hours: {
        unlimited: hoursUnlimited,
        allocated: allocHours,
        used: hoursUsed,
        left: allocHours == null ? null : Math.max(0, allocHours - hoursUsed),
        fromLogged: loggedHours,
        fromTickets: ticketHours,
      },
      visits: {
        allocated: allocVisits,
        used: cp.visitsUsed,
        left: allocVisits == null ? null : Math.max(0, allocVisits - cp.visitsUsed),
      },
      // This product's own purchase order, used when the client is on PRODUCT
      // scope. On CUSTOMER scope one PO covers everything and the screens read
      // the contract's fields instead.
      poNumber: cp.poNumber,
      poFileUrl: cp.poFileUrl,
      poFileName: cp.poFileName,
      // Paid-AMC terms shown so the customer knows what a subscription buys.
      paidTerms: {
        months: cp.paidAmcMonths,
        monthlyCost: hideMoney || cp.amcMonthlyCost == null ? null : Number(cp.amcMonthlyCost),
        hoursUnlimited: cp.paidAmcHoursUnlimited,
        hours: cp.paidAmcHoursUnlimited ? null : cp.paidAmcHours,
        visits: cp.paidAmcVisits,
      },
      // Period / carry-forward / excess config + (MONTHLY) this month's availability.
      support: await this.buildSupportView({
        scope: 'PRODUCT', ownerId: cp.id, clientId,
        period: cp.amcHoursPeriod, unlimited: hoursUnlimited, hours: allocHours,
        carryForward: cp.amcCarryForward, allowExcess: cp.amcAllowExcess,
        excessApproval: cp.amcExcessApproval, excessApproverId: cp.amcExcessApproverId,
        allowTicketsAfterHours: cp.amcAllowTicketsAfterHours,
      }),
    };
  }

  // ---- support hours logged on tickets ---------------------------------------

  /**
   * Time consultants logged on a customer's tickets, bucketed by the ticket's
   * product. Support hours are consumed two ways — a client visit draws the pool
   * down at write time, and `TicketWorklog` rows accumulate against the ticket —
   * so the pools the customer sees must add the ticket side in.
   *
   * Deliberately an on-read aggregate rather than a stored counter: deleting a
   * worklog corrects itself, and hours already logged count with no back-fill.
   */
  private async ticketHours(companyId: string, clientId: string) {
    const rows = await this.prisma.ticketWorklog.findMany({
      where: { clientId, ticket: { customerCompanyId: companyId } },
      select: { hours: true, workDate: true, ticket: { select: { productId: true } } },
    });
    const byProduct = new Map<string, LoggedHour[]>();
    const all: LoggedHour[] = [];
    for (const r of rows) {
      const entry: LoggedHour = { hours: Number(r.hours), at: r.workDate };
      all.push(entry);
      const pid = r.ticket.productId;
      if (!pid) continue;   // unrouted ticket — counts only against a shared contract
      const list = byProduct.get(pid);
      if (list) list.push(entry);
      else byProduct.set(pid, [entry]);
    }
    return { byProduct, all };
  }

  /**
   * Sum logged hours from a coverage window's start onward. Renewing zeroes the
   * stored counters, so the ticket side has to reset with them — otherwise last
   * period's time would keep eating the new pool. Nothing caps the far end: time
   * logged after coverage lapsed is still spent against the latest pool.
   */
  private hoursSince(entries: LoggedHour[] | undefined, start?: Date | null) {
    if (!entries?.length) return 0;
    const from = start ? start.getTime() : -Infinity;
    return entries.reduce((sum, e) => (e.at.getTime() >= from ? sum + e.hours : sum), 0);
  }

  /** Map of productId -> assigned agent usernames for a company (product-scoped + default). */
  private async agentsByProduct(companyId: string, clientId: string) {
    const rows = await this.prisma.customerConsultant.findMany({ where: { clientId, customerCompanyId: companyId } });
    if (!rows.length) return { byProduct: new Map<string, string[]>(), defaults: [] as string[] };
    const users = await this.prisma.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } }, select: { id: true, username: true } });
    const nameById = new Map(users.map((u) => [u.id, u.username]));
    // Dedupe per product — an agent assigned to several modules/tracks of the same
    // product should appear once.
    const byProductSet = new Map<string, Set<string>>();
    const defaultSet = new Set<string>();
    for (const r of rows) {
      if (!r.isPrimary) continue; // cards show only the primary consultant of each cell
      const name = nameById.get(r.userId);
      if (!name) continue;
      if (r.productId) {
        if (!byProductSet.has(r.productId)) byProductSet.set(r.productId, new Set());
        byProductSet.get(r.productId)!.add(name);
      } else defaultSet.add(name);
    }
    const byProduct = new Map<string, string[]>([...byProductSet].map(([k, v]) => [k, [...v]]));
    return { byProduct, defaults: [...defaultSet] };
  }

  private async ownedCompany(companyId: string, clientId: string) {
    const c = await this.prisma.customerCompany.findFirst({ where: { id: companyId, clientId } });
    if (!c) throw new NotFoundException('Customer company not found');
    return c;
  }

  /**
   * A customer is on exactly ONE coverage scope, so a write that belongs to the
   * other one must be refused rather than silently landing in a pool nothing
   * reads. The UI already hides these controls; this closes the API behind them.
   */
  private assertScope(company: { contractScope: string }, expected: 'PRODUCT' | 'CUSTOMER') {
    if (company.contractScope === expected) return;
    throw new BadRequestException(
      expected === 'PRODUCT'
        ? 'This customer is on one shared customer contract — edit the contract instead of per-product coverage.'
        : 'This customer is on per-product coverage — edit the product’s terms instead of a customer contract.',
    );
  }

  /** `ownedCp` plus the owning company, for scope-guarded per-product writes. */
  private async ownedCpInScope(cpId: string, clientId: string) {
    const cp = await this.prisma.customerCompanyProduct.findFirst({
      where: { id: cpId, customerCompany: { clientId } },
      include: { product: true, customerCompany: { select: { contractScope: true } } },
    });
    if (!cp) throw new NotFoundException('Customer product not found');
    this.assertScope(cp.customerCompany, 'PRODUCT');
    return cp;
  }

  // ---- provider: assign / edit / renew / remove ------------------------------

  async assignProduct(companyId: string, dto: AssignProductDto, clientId: string, actorId?: string) {
    // Under a shared contract the covered products are chosen by `setContract`,
    // which owns the one timeline; assigning per-product terms here would write
    // coverage no screen reads.
    this.assertScope(await this.ownedCompany(companyId, clientId), 'PRODUCT');
    const product = await this.prisma.product.findFirst({ where: { id: dto.productId, clientId } });
    if (!product) throw new NotFoundException('Product not found');

    // Coverage is ONE timeline: Warranty (free) OR AMC (paid), chosen by coverageType.
    // The DB keeps free* = warranty pool, paid* = AMC pool; amcType FREE = under
    // warranty, PAID = under AMC. Support-hours/visits go to the active phase's pool.
    const paid = dto.coverageType === 'AMC';
    const start = dto.startDate ? new Date(dto.startDate) : new Date();
    const end = dto.endDate ? new Date(dto.endDate) : monthsAfter(start, 12);
    this.assertRange(start, end);
    const months = monthsBetween(start, end);
    // Warranty is free support, so it starts Unlimited unless the caller says
    // otherwise; a paid AMC keeps the existing "type a figure" default.
    const pool = this.resolveHoursPool(dto.supportHoursUnlimited, dto.supportHours, !paid, null);
    if (dto.excessApproverId) await this.assertStaffUser(dto.excessApproverId, clientId);
    const data = {
      status: 'ACTIVE',
      purchaseDate: start,
      warrantyMonths: months,
      warrantyEnd: end,
      freeAmcMonths: months,
      amcType: paid ? 'PAID' : 'FREE',
      amcStart: start,
      amcEnd: end,
      paidAmcMonths: months,
      amcMonthlyCost: paid ? dto.contractAmount ?? null : null,
      // Only the active phase's pool is set on assign; the other stays empty until
      // the coverage is switched.
      freeAmcHours: paid ? null : pool.hours,
      freeAmcHoursUnlimited: paid ? true : pool.unlimited,
      freeAmcVisits: paid ? null : dto.visits ?? null,
      paidAmcHours: paid ? pool.hours : null,
      paidAmcHoursUnlimited: paid ? pool.unlimited : false,
      paidAmcVisits: paid ? dto.visits ?? null : null,
      hoursUsed: 0,
      visitsUsed: 0,
      expiryAlertSentAt: null,
      hoursAlertSentAt: null,
      warrantyAlertSentAt: null,
      // Support-hours config (defaults keep today's whole-term, no-excess behaviour).
      amcHoursPeriod: dto.hoursPeriod ?? 'FULL_AMC',
      amcCarryForward: dto.carryForward ?? false,
      amcAllowExcess: dto.allowExcess ?? false,
      amcExcessApproval: dto.excessApproval ?? false,
      amcAllowTicketsAfterHours: dto.allowTicketsAfterHours ?? true,
      amcExcessApproverId: dto.excessApproverId || null,
    };
    const cp = await this.prisma.customerCompanyProduct.upsert({
      where: { customerCompanyId_productId: { customerCompanyId: companyId, productId: dto.productId } },
      update: data,
      create: { customerCompanyId: companyId, productId: dto.productId, ...data },
    });
    // Seed a clean current-month ledger row for a MONTHLY pool.
    const isPaid = cp.amcType === 'PAID';
    const effUnlimited = isPaid ? cp.paidAmcHoursUnlimited : cp.freeAmcHoursUnlimited;
    const effHours = isPaid ? cp.paidAmcHours : cp.freeAmcHours;
    if (cp.amcHoursPeriod === 'MONTHLY' && !effUnlimited && effHours != null) {
      await this.resetLedgerForRenewal('PRODUCT', cp.id, clientId, effHours);
    }
    // A product can be assigned with its excess settings already filled in, so
    // this door raises the approval request too — see ensureExcessApprovalRequest.
    await this.ensureExcessApprovalRequest(clientId, companyId, dto.productId, actorId);
    return cp;
  }


  private async ownedCp(cpId: string, clientId: string) {
    const cp = await this.prisma.customerCompanyProduct.findFirst({
      where: { id: cpId, customerCompany: { clientId } },
      include: { product: true },
    });
    if (!cp) throw new NotFoundException('Customer product not found');
    return cp;
  }

  async updateTerms(cpId: string, dto: UpdateProductTermsDto, clientId: string, actorId?: string) {
    const cp = await this.ownedCpInScope(cpId, clientId);
    const wasType = cp.amcType === 'PAID' ? 'AMC' : 'WARRANTY';
    const coverageType = dto.coverageType ?? wasType;
    const paid = coverageType === 'AMC';
    const switched = coverageType !== wasType;   // switching phase → fresh pool
    // One coverage window; only the active phase's pool is written (the other is
    // preserved so switching back keeps its terms).
    const start = dto.startDate ? new Date(dto.startDate)
      : (paid ? cp.amcStart : cp.purchaseDate) ?? new Date();
    const end = dto.endDate ? new Date(dto.endDate)
      : (paid ? cp.amcEnd : cp.warrantyEnd) ?? monthsAfter(start, 12);
    this.assertRange(start, end);
    const months = monthsBetween(start, end);
    // Only touch the hours pool when the caller actually sent a choice, so a
    // partial edit (e.g. dates only) leaves the saved Unlimited/Limited state be.
    const wantsPool = dto.supportHoursUnlimited !== undefined || dto.supportHours !== undefined;
    const pool = wantsPool
      ? this.resolveHoursPool(
          dto.supportHoursUnlimited,
          dto.supportHours,
          paid ? cp.paidAmcHoursUnlimited : cp.freeAmcHoursUnlimited,
          paid ? cp.paidAmcHours : cp.freeAmcHours,
        )
      : null;
    if (dto.excessApproverId) await this.assertStaffUser(dto.excessApproverId, clientId);
    const updated = await this.prisma.customerCompanyProduct.update({
      where: { id: cpId },
      data: {
        purchaseDate: start,
        warrantyMonths: months,
        warrantyEnd: end,
        freeAmcMonths: months,
        paidAmcMonths: months,
        amcType: paid ? 'PAID' : 'FREE',
        amcStart: start,
        amcEnd: end,
        status: 'ACTIVE',
        expiryAlertSentAt: null,
        hoursAlertSentAt: null,
        ...(switched ? { hoursUsed: 0, visitsUsed: 0 } : {}),
        // Support-hours config (absent=keep, explicit-null clears the approver).
        ...(dto.hoursPeriod !== undefined ? { amcHoursPeriod: dto.hoursPeriod } : {}),
        ...(dto.carryForward !== undefined ? { amcCarryForward: dto.carryForward } : {}),
        ...(dto.allowExcess !== undefined ? { amcAllowExcess: dto.allowExcess } : {}),
        ...(dto.excessApproval !== undefined ? { amcExcessApproval: dto.excessApproval } : {}),
        ...(dto.allowTicketsAfterHours !== undefined ? { amcAllowTicketsAfterHours: dto.allowTicketsAfterHours } : {}),
        ...(dto.excessApproverId !== undefined
          ? { amcExcessApprover: dto.excessApproverId ? { connect: { id: dto.excessApproverId } } : { disconnect: true } }
          : {}),
        ...(paid
          ? {
              ...(dto.contractAmount !== undefined ? { amcMonthlyCost: dto.contractAmount } : {}),
              ...(pool ? { paidAmcHours: pool.hours, paidAmcHoursUnlimited: pool.unlimited } : {}),
              ...(dto.visits !== undefined ? { paidAmcVisits: dto.visits } : {}),
            }
          : {
              ...(pool ? { freeAmcHours: pool.hours, freeAmcHoursUnlimited: pool.unlimited } : {}),
              ...(dto.visits !== undefined ? { freeAmcVisits: dto.visits } : {}),
            }),
      },
    });
    // Keep the current month's ledger allocation in step with a MONTHLY figure.
    const isPaid = updated.amcType === 'PAID';
    const effUnlimited = isPaid ? updated.paidAmcHoursUnlimited : updated.freeAmcHoursUnlimited;
    const effHours = isPaid ? updated.paidAmcHours : updated.freeAmcHours;
    if (updated.amcHoursPeriod === 'MONTHLY' && !effUnlimited && effHours != null) {
      await this.refreshLedgerAllocation('PRODUCT', updated.id, clientId, effHours, updated.amcCarryForward);
    }
    // Naming an approver raises the request — see ensureExcessApprovalRequest.
    await this.ensureExcessApprovalRequest(clientId, updated.customerCompanyId, updated.productId, actorId);
    return updated;
  }

  /**
   * Fire "support hours running low" against whichever pool actually governs this
   * customer — their shared contract, or the named product's own pool. One entry
   * point so the worklog, the manual usage log and the visit log can never alert
   * off different numbers, and each pool alerts at most once per period.
   *
   * Uses `productSupportHours`, so the threshold is measured against the SAME
   * figure the ticket form and the product screens display (stored counter plus
   * ticket worklogs), not a stored counter alone.
   */
  private async alertIfHoursLow(clientId: string, companyId: string, productId: string | null) {
    const pool = await this.productSupportHours(clientId, companyId, productId ?? '');
    if (!pool.hasPool || pool.allocated == null) return;      // unlimited or unmapped
    if (pool.used < pool.allocated * 0.85) return;

    if (pool.scope === 'CUSTOMER') {
      const c = await this.prisma.customerCompany.findUnique({
        where: { id: companyId },
        select: { contractAlertSentAt: true },
      });
      if (c?.contractAlertSentAt) return;
      await this.prisma.customerCompany.update({
        where: { id: companyId },
        data: { contractAlertSentAt: new Date() },
      });
      await this.notifyCompanyAdmins(companyId, clientId, {
        type: 'CONTRACT', title: 'Support hours running low',
        body: `You've used ${pool.used} of ${pool.allocated} contracted support hours.`,
      });
      return;
    }

    const cp = await this.prisma.customerCompanyProduct.findFirst({
      where: { customerCompanyId: companyId, productId: productId ?? '' },
      select: { id: true, hoursAlertSentAt: true, product: { select: { name: true } } },
    });
    if (!cp || cp.hoursAlertSentAt) return;
    await this.prisma.customerCompanyProduct.update({
      where: { id: cp.id },
      data: { hoursAlertSentAt: new Date() },
    });
    await this.notifyCompanyAdmins(companyId, clientId, {
      type: 'PRODUCT_AMC', title: 'Support hours running low',
      body: `You've used ${pool.used} of ${pool.allocated} support hours for ${cp.product?.name ?? 'your product'}.`,
    });
  }

  /**
   * Public entry point for the ticket worklog path: time logged on a ticket
   * consumes the pool for that ticket's product under the customer's own scope.
   */
  async alertOnLoggedHours(clientId: string, companyId: string | null | undefined, productId: string | null | undefined) {
    if (!companyId) return;
    await this.alertIfHoursLow(clientId, companyId, productId ?? null);
  }

  /** Log support-hours / a site visit used against the current AMC period. */
  async logUsage(cpId: string, dto: { hours?: number; visits?: number }, clientId: string) {
    const cp = await this.ownedCpInScope(cpId, clientId);
    await this.assertHoursWithinAllowance(clientId, cp.customerCompanyId, cp.productId, dto.hours ?? 0);
    const updated = await this.prisma.customerCompanyProduct.update({
      where: { id: cpId },
      data: {
        hoursUsed: { increment: dto.hours ?? 0 },
        visitsUsed: { increment: dto.visits ?? 0 },
      },
      include: { product: true },
    });
    // MONTHLY pools track usage in the ledger; no-op otherwise.
    await this.adjustLoggedHours(clientId, updated.customerCompanyId, updated.productId, dto.hours ?? 0, new Date());
    await this.alertIfHoursLow(clientId, updated.customerCompanyId, updated.productId);
    return updated;
  }

  /** Renew into a paid AMC period from today; reactivates a terminated product. */
  async renewAmc(cpId: string, dto: RenewAmcDto, clientId: string) {
    const cp = await this.ownedCpInScope(cpId, clientId);
    const start = new Date();
    const months = dto.months ?? cp.paidAmcMonths ?? 12;
    const pool = this.resolveHoursPool(dto.amcHoursUnlimited, dto.amcHoursPerMonth, cp.paidAmcHoursUnlimited, cp.paidAmcHours);
    const updated = await this.prisma.customerCompanyProduct.update({
      where: { id: cpId },
      data: {
        status: 'ACTIVE',
        amcType: 'PAID',
        amcStart: start,
        amcEnd: monthsAfter(start, months),
        paidAmcMonths: months,
        amcMonthlyCost: dto.amcMonthlyCost ?? cp.amcMonthlyCost,
        paidAmcHours: pool.hours,
        paidAmcHoursUnlimited: pool.unlimited,
        paidAmcVisits: dto.amcVisitsPerMonth ?? cp.paidAmcVisits,
        // New paid period → fresh pools.
        hoursUsed: 0,
        visitsUsed: 0,
        expiryAlertSentAt: null,
        hoursAlertSentAt: null,
        warrantyAlertSentAt: cp.warrantyAlertSentAt,
      },
      include: { product: true },
    });
    // A new paid period starts a clean month for a MONTHLY pool.
    if (updated.amcHoursPeriod === 'MONTHLY' && !updated.paidAmcHoursUnlimited && updated.paidAmcHours != null) {
      await this.resetLedgerForRenewal('PRODUCT', updated.id, clientId, updated.paidAmcHours);
    }
    await this.notifyCompanyAdmins(cp.customerCompanyId, clientId, {
      type: 'PRODUCT_AMC', title: 'AMC renewed',
      body: `Your AMC for ${updated.product?.name ?? 'a product'} is active until ${updated.amcEnd?.toDateString()}.`,
    });
    return updated;
  }

  async removeProduct(cpId: string, clientId: string) {
    const cp = await this.ownedCp(cpId, clientId);
    await this.prisma.customerCompanyProduct.delete({ where: { id: cpId } });
    // Drop this client's consultants for the product too, so re-adding it later
    // starts fresh from the product's module mapping (not the old snapshot).
    await this.prisma.customerConsultant.deleteMany({ where: { customerCompanyId: cp.customerCompanyId, productId: cp.productId } });
    // The product's monthly ledger has no owner any more.
    await this.prisma.supportHoursLedger.deleteMany({ where: { scope: 'PRODUCT', ownerId: cpId } });
    return { message: 'Product removed from company' };
  }

  // ---- contract scope (product-specific vs one shared customer contract) -----

  /** Live view of a shared customer contract: period, hours + visits used/left. */
  private async contractView(c: CustomerCompany, ticketHours = 0, hideMoney = false) {
    const now = Date.now();
    // Same two sources as a per-product pool: directly logged usage + ticket worklogs.
    const loggedHours = Number(c.contractHoursUsed);
    const hoursUsed = loggedHours + ticketHours;
    // Unlimited coverage has no allocation at all — nothing to spend down.
    const allocHours = c.contractHoursUnlimited ? null : c.contractHours;
    return {
      scope: c.contractScope,
      coverageType: c.contractCoverageType,
      start: c.contractStart,
      end: c.contractEnd,
      hoursUnlimited: c.contractHoursUnlimited,
      hours: allocHours,
      visits: c.contractVisits,
      monthlyCost: hideMoney || c.contractMonthlyCost == null ? null : Number(c.contractMonthlyCost),
      // The purchase order this contract was raised against. Deliberately NOT
      // withheld from a non-Admin the way the money is: a PO number and its
      // invoice are the paperwork a consultant may legitimately need to quote,
      // and neither states what the client pays.
      poNumber: c.contractPoNumber,
      poFileUrl: c.contractPoFileUrl,
      poFileName: c.contractPoFileName,
      period: {
        pct: this.pctElapsed(c.contractStart, c.contractEnd),
        daysLeft: this.daysLeft(c.contractEnd),
        active: c.contractEnd ? c.contractEnd.getTime() > now : true,
      },
      hoursPool: {
        unlimited: c.contractHoursUnlimited,
        allocated: allocHours, used: hoursUsed,
        left: allocHours == null ? null : Math.max(0, allocHours - hoursUsed),
        fromLogged: loggedHours,
        fromTickets: ticketHours,
      },
      visitsPool: {
        allocated: c.contractVisits, used: c.contractVisitsUsed,
        left: c.contractVisits == null ? null : Math.max(0, c.contractVisits - c.contractVisitsUsed),
      },
      // Period / carry-forward / excess config + (MONTHLY) this month's availability.
      support: await this.buildSupportView({
        scope: 'CONTRACT', ownerId: c.id, clientId: c.clientId,
        period: c.contractHoursPeriod, unlimited: c.contractHoursUnlimited, hours: allocHours,
        carryForward: c.contractCarryForward, allowExcess: c.contractAllowExcess,
        excessApproval: c.contractExcessApproval, excessApproverId: c.contractExcessApproverId,
        allowTicketsAfterHours: c.contractAllowTicketsAfterHours,
      }),
    };
  }

  /** `contractView` with the ticket-logged hours for the whole company folded in. */
  private async contractViewFor(c: CustomerCompany, hideMoney = false) {
    const logged = await this.ticketHours(c.id, c.clientId);
    return this.contractView(c, this.hoursSince(logged.all, c.contractStart), hideMoney);
  }


  async getContract(companyId: string, clientId: string, hideMoney = false) {
    const c = await this.ownedCompany(companyId, clientId);
    const links = await this.prisma.customerCompanyProduct.findMany({ where: { customerCompanyId: companyId }, select: { productId: true } });
    return { ...(await this.contractViewFor(c, hideMoney)), productIds: links.map((l) => l.productId) };
  }

  async setContract(companyId: string, dto: SetContractDto, clientId: string, actorId?: string) {
    const company = await this.ownedCompany(companyId, clientId);

    if (dto.scope === 'CUSTOMER') {
      if (dto.start && dto.end) this.assertRange(new Date(dto.start), new Date(dto.end));
      const coverageType = dto.coverageType ?? company.contractCoverageType;
      /**
       * A partial payload moves only what it carries: an absent field is left
       * alone, an explicit `null` clears it. That is what lets the Contract type
       * switch write `{ scope: 'CUSTOMER' }` on its own and keep the terms the
       * client already has — sending that used to null the dates, the visits and
       * the amount, which is why the screen had to defer the switch to a second
       * Save contract press.
       */
      const data: Prisma.CustomerCompanyUpdateInput = {
        contractScope: 'CUSTOMER',
        contractAlertSentAt: null, // re-arm the "running low" alert on any change
      };
      if (dto.coverageType) data.contractCoverageType = dto.coverageType;
      if (dto.start !== undefined) data.contractStart = dto.start ? new Date(dto.start) : null;
      if (dto.end !== undefined) data.contractEnd = dto.end ? new Date(dto.end) : null;
      if (dto.visits !== undefined) data.contractVisits = dto.visits;
      // Support hours are re-resolved only when the payload actually carries the
      // Unlimited/Limited choice. A bare switch keeps the stored pool, and never
      // demands one from a client who has no customer contract yet.
      // Track the effective pool so the ledger step below sees the same figures.
      let effUnlimited = company.contractHoursUnlimited;
      let effHours = company.contractHours;
      if (dto.hoursUnlimited !== undefined || dto.hours !== undefined) {
        // Warranty is free support, so it defaults to Unlimited; AMC keeps
        // whatever the contract already had.
        const pool = this.resolveHoursPool(
          dto.hoursUnlimited,
          dto.hours ?? undefined,
          coverageType === 'WARRANTY' ? true : company.contractHoursUnlimited,
          company.contractHours,
        );
        data.contractHours = pool.hours;
        data.contractHoursUnlimited = pool.unlimited;
        effUnlimited = pool.unlimited;
        effHours = pool.hours;
      }
      // A warranty period is free, so it never carries a contract amount —
      // switching onto warranty clears a stale one whatever the caller sent.
      if (coverageType !== 'AMC') data.contractMonthlyCost = null;
      else if (dto.monthlyCost !== undefined) data.contractMonthlyCost = dto.monthlyCost;
      // Support-hours config (period / carry-forward / excess / approver), same
      // absent=keep, explicit-null=clear rule as the rest of the contract terms.
      if (dto.hoursPeriod !== undefined) data.contractHoursPeriod = dto.hoursPeriod;
      if (dto.carryForward !== undefined) data.contractCarryForward = dto.carryForward;
      if (dto.allowExcess !== undefined) data.contractAllowExcess = dto.allowExcess;
      if (dto.excessApproval !== undefined) data.contractExcessApproval = dto.excessApproval;
      if (dto.allowTicketsAfterHours !== undefined) data.contractAllowTicketsAfterHours = dto.allowTicketsAfterHours;
      if (dto.excessApproverId !== undefined) {
        if (dto.excessApproverId) await this.assertStaffUser(dto.excessApproverId, clientId);
        data.contractExcessApprover = dto.excessApproverId
          ? { connect: { id: dto.excessApproverId } }
          : { disconnect: true };
      }
      await this.prisma.customerCompany.update({ where: { id: companyId }, data });
      // Keep the current month's ledger allocation in step with a MONTHLY figure.
      const effPeriod = dto.hoursPeriod ?? company.contractHoursPeriod;
      const effCarry = dto.carryForward ?? company.contractCarryForward;
      if (effPeriod === 'MONTHLY' && !effUnlimited && effHours != null) {
        await this.refreshLedgerAllocation('CONTRACT', companyId, clientId, effHours, effCarry);
      }
      // The ticked products are exactly what this contract covers.
      if (dto.productIds) {
        const valid = await this.prisma.product.findMany({ where: { id: { in: dto.productIds }, clientId }, select: { id: true } });
        const ids = valid.map((v) => v.id);
        for (const id of ids) {
          await this.prisma.customerCompanyProduct.upsert({
            where: { customerCompanyId_productId: { customerCompanyId: companyId, productId: id } },
            update: { status: 'ACTIVE' },
            create: { customerCompanyId: companyId, productId: id, status: 'ACTIVE' },
          });
        }
        await this.prisma.customerCompanyProduct.deleteMany({ where: { customerCompanyId: companyId, productId: { notIn: ids } } });
        // Also drop consultants for products no longer covered, so re-adding re-seeds.
        await this.prisma.customerConsultant.deleteMany({ where: { customerCompanyId: companyId, productId: { not: null, notIn: ids } } });
      }
    } else {
      await this.prisma.customerCompany.update({ where: { id: companyId }, data: { contractScope: 'PRODUCT' } });
    }
    // Switching scope moves which pool governs, so the pools left behind stop
    // deciding anything. Their still-open questions are withdrawn — otherwise a
    // PENDING request sits in an approver's queue forever, addressed to a pool
    // no screen renders any more. Decided rows are kept: they are the record of
    // a decision that really was made, and the pool's own screen still shows them.
    if (company.contractScope !== dto.scope) {
      await this.prisma.supportHoursExcessRequest.deleteMany({
        where: {
          customerCompanyId: companyId,
          status: 'PENDING',
          scope: dto.scope === 'CUSTOMER' ? 'PRODUCT' : 'CONTRACT',
        },
      });
    }
    // Then raise for whichever pools govern now — see ensureExcessApprovalRequest.
    if (dto.scope === 'CUSTOMER') {
      await this.ensureExcessApprovalRequest(clientId, companyId, null, actorId);
    } else {
      const covered = await this.prisma.customerCompanyProduct.findMany({
        where: { customerCompanyId: companyId }, select: { productId: true },
      });
      for (const cp of covered) {
        await this.ensureExcessApprovalRequest(clientId, companyId, cp.productId, actorId);
      }
    }
    return this.getContract(companyId, clientId);
  }

  // ---- purchase order: the number and its invoice ---------------------------
  //
  // Both save on their own, the moment they are entered — neither waits for the
  // Save press the terms beside them use. That is deliberate: a PO and its
  // invoice are paperwork attached to a contract rather than terms of it, and
  // half-entering one, navigating away and finding it gone is not a trade anyone
  // would make. It also keeps them off `updateTerms`, which normalises the
  // coverage window and re-activates the row on every call — side effects that
  // have no business firing because someone typed a PO number.

  async setContractPoNumber(companyId: string, clientId: string, poNumber?: string | null) {
    await this.ownedCompany(companyId, clientId);
    await this.prisma.customerCompany.update({
      where: { id: companyId },
      data: { contractPoNumber: poNumber?.trim() || null },
    });
    return this.getContract(companyId, clientId);
  }

  async setProductPoNumber(cpId: string, clientId: string, poNumber?: string | null) {
    await this.ownedCp(cpId, clientId);
    return this.prisma.customerCompanyProduct.update({
      where: { id: cpId },
      data: { poNumber: poNumber?.trim() || null },
      select: { id: true, poNumber: true, poFileUrl: true, poFileName: true },
    });
  }


  /**
   * The PO invoice is a file, so it cannot ride the contract's JSON body — it
   * gets a multipart route of its own, on the same template as the client logo:
   * store the served path, keep the name the admin uploaded, and unlink the file
   * being replaced so the disk does not fill with orphans.
   *
   * Which pair is written follows the contract scope, exactly as the terms do —
   * one invoice for a shared customer contract, one per product otherwise.
   */
  async setContractPoInvoice(
    companyId: string, clientId: string, file: { url: string; name: string },
  ) {
    const c = await this.ownedCompany(companyId, clientId);
    if (c.contractPoFileUrl) await this.deletePoFile(c.contractPoFileUrl);
    await this.prisma.customerCompany.update({
      where: { id: companyId },
      data: { contractPoFileUrl: file.url, contractPoFileName: file.name },
    });
    return this.getContract(companyId, clientId);
  }

  async clearContractPoInvoice(companyId: string, clientId: string) {
    const c = await this.ownedCompany(companyId, clientId);
    if (c.contractPoFileUrl) await this.deletePoFile(c.contractPoFileUrl);
    await this.prisma.customerCompany.update({
      where: { id: companyId },
      data: { contractPoFileUrl: null, contractPoFileName: null },
    });
    return this.getContract(companyId, clientId);
  }

  async setProductPoInvoice(cpId: string, clientId: string, file: { url: string; name: string }) {
    const cp = await this.ownedCp(cpId, clientId);
    if (cp.poFileUrl) await this.deletePoFile(cp.poFileUrl);
    return this.prisma.customerCompanyProduct.update({
      where: { id: cpId },
      data: { poFileUrl: file.url, poFileName: file.name },
      select: { id: true, poNumber: true, poFileUrl: true, poFileName: true },
    });
  }

  async clearProductPoInvoice(cpId: string, clientId: string) {
    const cp = await this.ownedCp(cpId, clientId);
    if (cp.poFileUrl) await this.deletePoFile(cp.poFileUrl);
    return this.prisma.customerCompanyProduct.update({
      where: { id: cpId },
      data: { poFileUrl: null, poFileName: null },
      select: { id: true, poNumber: true, poFileUrl: true, poFileName: true },
    });
  }

  /** Best-effort unlink of a replaced/removed invoice — mirrors deleteLogoFile. */
  private async deletePoFile(fileUrl: string) {
    try {
      await unlink(join(process.cwd(), fileUrl.replace(/^\//, '')));
    } catch {
      // best-effort cleanup — the file may already be gone
    }
  }

  /** Contract view for the signed-in customer (drives their My Products layout). */
  async myContract(companyId: string, clientId: string) {
    const c = await this.prisma.customerCompany.findFirst({ where: { id: companyId, clientId } });
    if (!c) return { scope: 'PRODUCT' as const };
    return this.contractViewFor(c);
  }

  /** Log support hours / a site visit against the shared customer contract pool. */
  async logContractUsage(companyId: string, dto: { hours?: number; visits?: number }, clientId: string) {
    this.assertScope(await this.ownedCompany(companyId, clientId), 'CUSTOMER');
    await this.assertHoursWithinAllowance(clientId, companyId, null, dto.hours ?? 0);
    const c = await this.prisma.customerCompany.update({
      where: { id: companyId },
      data: { contractHoursUsed: { increment: dto.hours ?? 0 }, contractVisitsUsed: { increment: dto.visits ?? 0 } },
    });
    // MONTHLY contracts track usage in the ledger; no-op otherwise.
    await this.adjustLoggedHours(clientId, companyId, null, dto.hours ?? 0, new Date());
    await this.alertIfHoursLow(clientId, companyId, null);
    return this.contractViewFor(c);
  }

  /** Renew the customer contract into a fresh period (resets used hours/visits). */
  async renewContract(companyId: string, dto: RenewContractDto, clientId: string) {
    const c = await this.ownedCompany(companyId, clientId);
    // Renewing must not be a back door that flips a per-product customer over.
    this.assertScope(c, 'CUSTOMER');
    const start = new Date();
    const pool = this.resolveHoursPool(dto.hoursUnlimited, dto.hours, c.contractHoursUnlimited, c.contractHours);
    const updated = await this.prisma.customerCompany.update({
      where: { id: companyId },
      data: {
        contractScope: 'CUSTOMER',
        contractStart: start,
        contractEnd: monthsAfter(start, dto.months),
        contractHours: pool.hours,
        contractHoursUnlimited: pool.unlimited,
        contractVisits: dto.visits ?? c.contractVisits,
        contractMonthlyCost:
          c.contractCoverageType === 'AMC' ? (dto.monthlyCost ?? c.contractMonthlyCost) : null,
        contractHoursUsed: 0,
        contractVisitsUsed: 0,
        contractAlertSentAt: null,
      },
    });
    // A renewal starts a clean month for a MONTHLY contract.
    if (updated.contractHoursPeriod === 'MONTHLY' && !updated.contractHoursUnlimited && updated.contractHours != null) {
      await this.resetLedgerForRenewal('CONTRACT', companyId, clientId, updated.contractHours);
    }
    await this.notifyCompanyAdmins(companyId, clientId, {
      type: 'CONTRACT', title: 'Support contract renewed',
      body: `Your support contract is active until ${updated.contractEnd?.toDateString()}.`,
    });
    return this.contractViewFor(updated);
  }

  async listCompanyProducts(companyId: string, clientId: string, hideMoney = false) {
    await this.ownedCompany(companyId, clientId);
    const [rows, agents, logged] = await Promise.all([
      this.prisma.customerCompanyProduct.findMany({ where: { customerCompanyId: companyId }, include: { product: true }, orderBy: { createdAt: 'asc' } }),
      this.agentsByProduct(companyId, clientId),
      this.ticketHours(companyId, clientId),
    ]);
    return Promise.all(rows.map((r) => this.toView(
      r,
      clientId,
      agents.byProduct.get(r.productId) ?? agents.defaults,
      this.hoursSince(logged.byProduct.get(r.productId), r.amcStart),
      hideMoney,
    )));
  }

  // ---- customer: my products, catalogue, requests ----------------------------

  async listMyProducts(clientId: string, companyId: string) {
    const [rows, agents, logged] = await Promise.all([
      this.prisma.customerCompanyProduct.findMany({ where: { customerCompanyId: companyId, customerCompany: { clientId } }, include: { product: true }, orderBy: { createdAt: 'asc' } }),
      this.agentsByProduct(companyId, clientId),
      this.ticketHours(companyId, clientId),
    ]);
    return Promise.all(rows.map((r) => this.toView(
      r,
      clientId,
      agents.byProduct.get(r.productId) ?? agents.defaults,
      this.hoursSince(logged.byProduct.get(r.productId), r.amcStart),
    )));
  }

  /**
   * The read-only support-hours figure the ticket form shows the moment a product
   * is picked ("86 / 100 hrs spent"). Follows the customer's contract scope: their
   * one shared pool when they are on a customer contract, otherwise the product's
   * own warranty/AMC pool. Never throws — an unknown product just has no pool.
   */
  async productSupportHours(clientId: string, companyId: string, productId: string) {
    const company = await this.prisma.customerCompany.findFirst({ where: { id: companyId, clientId } });
    if (!company) return { hasPool: false as const, allocated: null, used: 0, left: null };
    const logged = await this.ticketHours(companyId, clientId);

    if (company.contractScope === 'CUSTOMER') {
      const allocated = company.contractHoursUnlimited ? null : company.contractHours;
      // MONTHLY: the pool is this calendar month's ledger row (allocation + any
      // carried-in), not the whole-term counter.
      if (company.contractHoursPeriod === 'MONTHLY' && allocated != null) {
        const m = await this.monthlyAvailability({
          scope: 'CONTRACT', ownerId: company.id, clientId, hours: allocated, carryForward: company.contractCarryForward,
        });
        const cap = m.allocated + m.carriedIn;
        return {
          hasPool: true, unlimited: false, scope: 'CUSTOMER' as const, coverage: company.contractCoverageType,
          allocated: cap, used: m.used, left: Math.max(0, cap - m.used),
        };
      }
      // FULL_AMC: one pool covers every product, so unrouted ticket time counts too.
      const used = Number(company.contractHoursUsed) + this.hoursSince(logged.all, company.contractStart);
      return {
        hasPool: allocated != null,
        unlimited: company.contractHoursUnlimited,
        scope: 'CUSTOMER' as const,
        coverage: company.contractCoverageType,
        allocated,
        used,
        left: allocated == null ? null : Math.max(0, allocated - used),
      };
    }

    const cp = await this.prisma.customerCompanyProduct.findFirst({ where: { customerCompanyId: companyId, productId } });
    if (!cp) return { hasPool: false as const, allocated: null, used: 0, left: null };
    const paidPhase = cp.amcType === 'PAID';
    const unlimited = paidPhase ? cp.paidAmcHoursUnlimited : cp.freeAmcHoursUnlimited;
    const allocated = unlimited ? null : paidPhase ? cp.paidAmcHours : cp.freeAmcHours;
    const coverage = cp.amcType === 'PAID' ? 'AMC' : 'WARRANTY';
    if (cp.amcHoursPeriod === 'MONTHLY' && allocated != null) {
      const m = await this.monthlyAvailability({
        scope: 'PRODUCT', ownerId: cp.id, clientId, hours: allocated, carryForward: cp.amcCarryForward,
      });
      const cap = m.allocated + m.carriedIn;
      return {
        hasPool: true, unlimited: false, scope: 'PRODUCT' as const, coverage,
        allocated: cap, used: m.used, left: Math.max(0, cap - m.used),
      };
    }
    const used = Number(cp.hoursUsed) + this.hoursSince(logged.byProduct.get(productId), cp.amcStart);
    return {
      hasPool: allocated != null,
      unlimited,
      scope: 'PRODUCT' as const,
      coverage,
      allocated,
      used,
      left: allocated == null ? null : Math.max(0, allocated - used),
    };
  }

  /** Active provider products the customer doesn't already own or have pending. */
  async requestableProducts(clientId: string, companyId: string) {
    const [owned, pending, products] = await Promise.all([
      this.prisma.customerCompanyProduct.findMany({ where: { customerCompanyId: companyId }, select: { productId: true } }),
      this.prisma.productRequest.findMany({ where: { customerCompanyId: companyId, status: 'PENDING' }, select: { productId: true } }),
      this.prisma.product.findMany({ where: { clientId, isActive: true }, orderBy: { sortOrder: 'asc' }, select: { id: true, name: true, code: true, description: true } }),
    ]);
    const taken = new Set([...owned.map((o) => o.productId), ...pending.map((p) => p.productId)]);
    return products.filter((p) => !taken.has(p.id));
  }

  async createRequest(clientId: string, companyId: string, dto: CreateProductRequestDto, userId: string) {
    const product = await this.prisma.product.findFirst({ where: { id: dto.productId, clientId } });
    if (!product) throw new NotFoundException('Product not found');
    const already = await this.prisma.customerCompanyProduct.findFirst({ where: { customerCompanyId: companyId, productId: dto.productId } });
    if (already) throw new ConflictException('You already use this product');
    const dup = await this.prisma.productRequest.findFirst({ where: { customerCompanyId: companyId, productId: dto.productId, status: 'PENDING' } });
    if (dup) throw new ConflictException('A request for this product is already pending');

    const req = await this.prisma.productRequest.create({
      data: { clientId, customerCompanyId: companyId, productId: dto.productId, note: dto.note?.trim() || null, requestedById: userId },
    });
    const company = await this.prisma.customerCompany.findUnique({ where: { id: companyId }, select: { name: true } });
    // Notify all provider admins of the tenant.
    const admins = await this.prisma.user.findMany({
      where: { clientId, isActive: true, userRoles: { some: { role: { name: 'Admin' } } } },
      select: { id: true },
    });
    await this.notifications.notifyMany(admins.map((a) => a.id), {
      clientId, type: 'PRODUCT_REQUEST', title: 'New product request',
      body: `${company?.name ?? 'A customer'} requested ${product.name}.`,
    });
    return req;
  }

  async listMyRequests(companyId: string, clientId: string) {
    return this.prisma.productRequest.findMany({
      where: { customerCompanyId: companyId, clientId },
      include: { product: { select: { name: true, code: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** A customer asking to renew/extend service on an expiring or expired product. */
  async requestRenewal(cpId: string, clientId: string, companyId: string) {
    const cp = await this.prisma.customerCompanyProduct.findFirst({
      where: { id: cpId, customerCompanyId: companyId, customerCompany: { clientId } },
      include: { product: true },
    });
    if (!cp) throw new NotFoundException('Customer product not found');
    const company = await this.prisma.customerCompany.findUnique({ where: { id: companyId }, select: { name: true } });
    const admins = await this.prisma.user.findMany({
      where: { clientId, isActive: true, userRoles: { some: { role: { name: 'Admin' } } } },
      select: { id: true },
    });
    await this.notifications.notifyMany(admins.map((a) => a.id), {
      clientId, type: 'PRODUCT_RENEWAL', title: 'AMC renewal requested',
      body: `${company?.name ?? 'A customer'} wants to renew service for ${cp.product?.name}.`,
    });
    return { message: 'Renewal request sent to your provider' };
  }

  // ---- provider: request queue -----------------------------------------------

  async listRequests(clientId: string) {
    return this.prisma.productRequest.findMany({
      where: { clientId },
      include: { product: { select: { name: true, code: true } }, customerCompany: { select: { name: true } } },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async grantRequest(requestId: string, dto: GrantRequestDto, clientId: string, actorId: string) {
    const req = await this.prisma.productRequest.findFirst({ where: { id: requestId, clientId }, include: { product: true } });
    if (!req) throw new NotFoundException('Request not found');
    if (req.status !== 'PENDING') throw new BadRequestException('This request has already been decided');

    await this.assignProduct(req.customerCompanyId, { productId: req.productId, ...dto }, clientId);
    await this.prisma.productRequest.update({ where: { id: requestId }, data: { status: 'GRANTED', decidedById: actorId, decidedAt: new Date() } });
    await this.notifyCompanyAdmins(req.customerCompanyId, clientId, {
      type: 'PRODUCT_REQUEST', title: 'Product request approved',
      body: `${req.product?.name} is now available to you.`,
    });
    return { message: 'Request granted' };
  }

  async declineRequest(requestId: string, note: string | undefined, clientId: string, actorId: string) {
    const req = await this.prisma.productRequest.findFirst({ where: { id: requestId, clientId }, include: { product: true } });
    if (!req) throw new NotFoundException('Request not found');
    if (req.status !== 'PENDING') throw new BadRequestException('This request has already been decided');
    await this.prisma.productRequest.update({ where: { id: requestId }, data: { status: 'DECLINED', decisionNote: note?.trim() || null, decidedById: actorId, decidedAt: new Date() } });
    await this.notifyCompanyAdmins(req.customerCompanyId, clientId, {
      type: 'PRODUCT_REQUEST', title: 'Product request declined',
      body: `Your request for ${req.product?.name} was declined${note ? `: ${note.trim()}` : ''}.`,
    });
    return { message: 'Request declined' };
  }

  // ---- customer-level consultants (auto-assignment overrides) ----------------

  async listCustomerConsultants(companyId: string, clientId: string) {
    await this.ownedCompany(companyId, clientId);
    const rows = await this.prisma.customerConsultant.findMany({ where: { customerCompanyId: companyId, clientId }, orderBy: { createdAt: 'asc' } });
    const users = await this.prisma.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } }, select: { id: true, username: true } });
    const nameById = new Map(users.map((u) => [u.id, u.username]));
    return rows.map((r) => ({ id: r.id, userId: r.userId, username: nameById.get(r.userId) ?? null, productId: r.productId, moduleId: r.moduleId, track: r.track, isPrimary: r.isPrimary }));
  }

  async addCustomerConsultant(companyId: string, dto: AddCustomerConsultantDto, clientId: string) {
    await this.ownedCompany(companyId, clientId);
    const user = await this.prisma.user.findFirst({ where: { id: dto.userId, clientId } });
    if (!user) throw new NotFoundException('User not found');
    if (dto.moduleId && !dto.productId) throw new BadRequestException('A module needs its product');
    // A "cell" is a (product, module, track) group; one agent is primary per cell.
    const group = { customerCompanyId: companyId, productId: dto.productId ?? null, moduleId: dto.moduleId ?? null, track: dto.track ?? null };
    const existing = await this.prisma.customerConsultant.findMany({ where: group });
    const dup = existing.find((c) => c.userId === dto.userId);
    if (dup) return dup;
    const makePrimary = dto.isPrimary ?? existing.length === 0; // first in the cell is primary
    if (makePrimary && existing.length) await this.prisma.customerConsultant.updateMany({ where: group, data: { isPrimary: false } });
    return this.prisma.customerConsultant.create({ data: { clientId, userId: dto.userId, isPrimary: makePrimary, ...group } });
  }

  async removeCustomerConsultant(id: string, clientId: string) {
    const row = await this.prisma.customerConsultant.findFirst({ where: { id, clientId } });
    if (!row) throw new NotFoundException('Not found');
    await this.prisma.customerConsultant.delete({ where: { id } });
    // If the primary was removed, promote the next agent in the same cell.
    if (row.isPrimary) {
      const next = await this.prisma.customerConsultant.findFirst({
        where: { customerCompanyId: row.customerCompanyId, productId: row.productId, moduleId: row.moduleId, track: row.track },
        orderBy: { createdAt: 'asc' },
      });
      if (next) await this.prisma.customerConsultant.update({ where: { id: next.id }, data: { isPrimary: true } });
    }
    return { message: 'Removed' };
  }

  async setCustomerPrimary(id: string, clientId: string) {
    const row = await this.prisma.customerConsultant.findFirst({ where: { id, clientId } });
    if (!row) throw new NotFoundException('Not found');
    const group = { customerCompanyId: row.customerCompanyId, productId: row.productId, moduleId: row.moduleId, track: row.track };
    await this.prisma.$transaction([
      this.prisma.customerConsultant.updateMany({ where: group, data: { isPrimary: false } }),
      this.prisma.customerConsultant.update({ where: { id }, data: { isPrimary: true } }),
    ]);
    return { message: 'Primary updated' };
  }

  /**
   * Whether this client's tickets are auto-routed at all. Off means every ticket
   * they raise lands unassigned for a manager to pick — regardless of
   * contractScope, which is why the flag carries no contract* prefix. A ticket
   * with no company (staff-raised) is never auto-routed, so it reads false.
   */
  async autoAssignEnabled(clientId: string, customerCompanyId: string | null): Promise<boolean> {
    if (!customerCompanyId) return false;
    const company = await this.prisma.customerCompany.findFirst({
      where: { id: customerCompanyId, clientId },
      select: { autoAssignTickets: true },
    });
    return company?.autoAssignTickets ?? false;
  }

  /**
   * Pick a customer-level consultant override for a ticket, most specific first:
   * product+module(+track) → product-wide → the customer's default. Within each
   * tier the ordered candidates are walked and the FIRST one the caller accepts
   * wins; a tier is left only when every candidate in it is rejected. Null means
   * "try the product's own routing" — or, once that is exhausted too, leave the
   * ticket unassigned.
   *
   * `isEligible` is the caller's availability test (an active staff user holding
   * no open ticket) — see `TicketsService.create()`. It is deliberately not
   * computed here: one query serves every tier instead of one per candidate.
   */
  async resolveCustomerConsultant(
    clientId: string, customerCompanyId: string | null,
    productId: string | null, moduleId: string | null, track: 'TECHNICAL' | 'FUNCTIONAL' | null,
    isEligible: (userId: string) => boolean,
  ): Promise<string | null> {
    if (!customerCompanyId) return null;
    const rows = await this.prisma.customerConsultant.findMany({ where: { clientId, customerCompanyId } });
    if (!rows.length) return null;

    // Tier 1 — the customer's own consultants for this product. Rows set against
    // the exact module win, but a product-level row (moduleId null, e.g. an
    // unsplit product) must still match a ticket that names a module.
    const forProduct = rows.filter((r) => r.productId && r.productId === productId);
    const scoped = forProduct.filter((r) => r.moduleId === moduleId);
    const productWide = forProduct.filter((r) => !r.moduleId);
    // Tier 2 — contract-level common consultants (no product/module) handle every
    // covered product; match the ticket's track first, then a track-less catch-all.
    const contract = rows.filter((r) => !r.productId && !r.moduleId);
    // Within a matching cell, the primary agent leads the walk — but the first
    // one who is actually free takes the ticket.
    const byPrimary = (a: typeof rows[number], b: typeof rows[number]) => Number(b.isPrimary) - Number(a.isPrimary);
    // A row only serves the ticket's track. A track-less row is the grid's
    // "Others" column, so it answers a ticket that names no track — it must NOT
    // absorb a FUNCTIONAL ticket just because the client set someone under Others.
    const forTrack = (list: typeof rows) =>
      track
        ? list.filter((r) => r.track === track).sort(byPrimary)
        : [...list.filter((r) => !r.track).sort(byPrimary), ...[...list].sort(byPrimary)];
    // `forTrack`'s no-track branch deliberately concatenates the track-less rows
    // with the whole list (track-less first, then anyone). Taking [0] hid the
    // overlap; walking the list does not, so collapse repeats by userId — the
    // earlier position is the stronger claim. `isEligible` also carries the
    // active-user test the old trailing lookup did, so an inactive consultant is
    // now stepped over rather than aborting the walk.
    const walk = (list: typeof rows) => {
      const seen = new Set<string>();
      for (const r of forTrack(list)) {
        if (seen.has(r.userId)) continue;
        seen.add(r.userId);
        if (isEligible(r.userId)) return r.userId;
      }
      return null;
    };
    return (
      walk(scoped)          // 1) client-level, this product + module
      ?? walk(productWide)  // 1) client-level, this product (any module)
      ?? walk(contract)     // 2) the client's default consultants
    );
  }

  // ---- monthly ledger roll-forward (called by the timer) ---------------------

  /**
   * Open the current month for every MONTHLY support-hours pool that has no row
   * yet, carrying the previous month's unused balance forward when the pool is set
   * to carry-forward. Idempotent — the unique (scope, ownerId, periodLabel) makes
   * re-running a no-op — and lazy: a pool viewed or logged against already had its
   * row created, so this only backfills quiet pools.
   */
  async rollForwardLedgers() {
    const label = this.periodLabel();
    let created = 0;

    const companies = await this.prisma.customerCompany.findMany({
      where: {
        contractScope: 'CUSTOMER', contractHoursPeriod: 'MONTHLY',
        contractHoursUnlimited: false, contractHours: { not: null },
      },
      select: { id: true, clientId: true, contractHours: true, contractCarryForward: true },
    });
    for (const c of companies) {
      const exists = await this.prisma.supportHoursLedger.findUnique({
        where: { scope_ownerId_periodLabel: { scope: 'CONTRACT', ownerId: c.id, periodLabel: label } },
      });
      // A MONTHLY pool's approval is per calendar month, so the new month needs
      // its own ask — without this the approval tab goes blank on the 1st until
      // somebody happens to re-save the settings. Idempotent, so running it on
      // every sweep is safe.
      await this.ensureExcessApprovalRequest(c.clientId, c.id, null);
      if (exists) continue;
      await this.ledgerRowFor('CONTRACT', c.id, c.clientId, c.contractHours!, c.contractCarryForward);
      created++;
    }

    const cps = await this.prisma.customerCompanyProduct.findMany({
      where: { customerCompany: { contractScope: 'PRODUCT' }, amcHoursPeriod: 'MONTHLY' },
      select: {
        id: true, amcType: true, amcCarryForward: true, customerCompanyId: true, productId: true,
        paidAmcHours: true, paidAmcHoursUnlimited: true, freeAmcHours: true, freeAmcHoursUnlimited: true,
        customerCompany: { select: { clientId: true } },
      },
    });
    for (const cp of cps) {
      const paid = cp.amcType === 'PAID';
      const unlimited = paid ? cp.paidAmcHoursUnlimited : cp.freeAmcHoursUnlimited;
      const hours = paid ? cp.paidAmcHours : cp.freeAmcHours;
      if (unlimited || hours == null) continue;
      const exists = await this.prisma.supportHoursLedger.findUnique({
        where: { scope_ownerId_periodLabel: { scope: 'PRODUCT', ownerId: cp.id, periodLabel: label } },
      });
      await this.ensureExcessApprovalRequest(cp.customerCompany.clientId, cp.customerCompanyId, cp.productId);
      if (exists) continue;
      await this.ledgerRowFor('PRODUCT', cp.id, cp.customerCompany.clientId, hours, cp.amcCarryForward);
      created++;
    }
    return { created };
  }

  // ---- expiry sweep (called by the timer) ------------------------------------

  /**
   * Email + notify the client once their coverage is `EXPIRY_ALERT_DAYS` (30)
   * from its end, and terminate service (block new tickets) once it has fully
   * lapsed. `expiryAlertSentAt` / `contractAlertSentAt` keep it to one warning
   * per period; both are cleared whenever the terms are changed or renewed.
   */
  async runExpirySweep() {
    // Per-product coverage only governs customers on PRODUCT scope. Switching a
    // customer to a shared contract leaves their old per-product amcEnd dates in
    // place (deliberately, so switching back keeps the terms) — without this
    // filter those stale dates would keep expiring products and firing alerts for
    // coverage the customer no longer runs on.
    const active = await this.prisma.customerCompanyProduct.findMany({
      where: {
        status: 'ACTIVE',
        amcEnd: { not: null },
        customerCompany: { contractScope: 'PRODUCT' },
      },
      include: { product: true, customerCompany: { select: { id: true, name: true, clientId: true, contactEmail: true } } },
    });
    const now = Date.now();
    for (const cp of active) {
      if (!cp.amcEnd) continue;
      const lapsed = cp.amcEnd.getTime() <= now;
      const left = daysLeft(cp.amcEnd);

      if (lapsed) {
        await this.prisma.customerCompanyProduct.update({ where: { id: cp.id }, data: { status: 'EXPIRED' } });
        await this.fireCoverageAlert(cp, 'expired');
      } else if (left <= EXPIRY_ALERT_DAYS && !cp.expiryAlertSentAt) {
        await this.prisma.customerCompanyProduct.update({ where: { id: cp.id }, data: { expiryAlertSentAt: new Date() } });
        await this.fireCoverageAlert(cp, 'expiring', left);
      }

    }

    // Shared customer contracts: one warning 30 days out, same as per-product.
    const contracts = await this.prisma.customerCompany.findMany({
      where: { contractScope: 'CUSTOMER', contractEnd: { not: null }, contractAlertSentAt: null },
      select: { id: true, name: true, clientId: true, contractStart: true, contractEnd: true, contactEmail: true, contractCoverageType: true },
    });
    for (const c of contracts) {
      if (!c.contractEnd) continue;
      const left = daysLeft(c.contractEnd);
      if (left > EXPIRY_ALERT_DAYS) continue;
      await this.prisma.customerCompany.update({ where: { id: c.id }, data: { contractAlertSentAt: new Date() } });
      const cover = c.contractCoverageType === 'WARRANTY' ? 'warranty' : 'support contract';
      const title = `Your ${cover} ends in ${Math.max(left, 0)} day(s)`;
      const body = `Your ${cover} ends on ${c.contractEnd.toDateString()}. Renew to keep service running.`;
      await this.notifyCompanyAdmins(c.id, c.clientId, { type: 'CONTRACT', title, body });
      // The per-product path emails the client; the shared contract must too, or
      // a customer on one pooled contract only ever gets the in-app bell.
      await this.emailCompany(c, title, body, 'expiring');
    }
    return { scanned: active.length, contracts: contracts.length };
  }

  private async fireCoverageAlert(
    cp: CustomerCompanyProduct & { product?: { name: string } | null; customerCompany?: { id: string; name: string; clientId: string; contactEmail: string | null } | null },
    phase: 'expiring' | 'expired',
    daysRemaining?: number,
  ) {
    const company = cp.customerCompany;
    if (!company) return;
    const name = cp.product?.name ?? 'your product';
    const cover = cp.amcType === 'FREE' ? 'Warranty' : 'AMC';   // FREE = under warranty
    const endsOn = cp.amcEnd ? cp.amcEnd.toDateString() : null;
    const left = Math.max(daysRemaining ?? 0, 0);
    const subject = phase === 'expired'
      ? `${cover} ended for ${name}`
      : `${cover} for ${name} ends in ${left} day(s)`;
    const body = phase === 'expired'
      ? (cp.amcType === 'FREE'
          ? `The warranty for ${name} has ended — start a paid AMC to keep service running.`
          : `The AMC for ${name} has ended and service is now paused. Renew to continue.`)
      : (cp.amcType === 'FREE'
          ? `The warranty for ${name} ends${endsOn ? ` on ${endsOn}` : ' soon'} — after it, a paid AMC begins.`
          : `The AMC for ${name} ends${endsOn ? ` on ${endsOn}` : ' soon'}. Renew to keep service running.`);

    await this.notifyCompanyAdmins(company.id, company.clientId, { type: 'PRODUCT_AMC', title: subject, body });
    await this.emailCompany(company, subject, body, phase);
  }

  /**
   * Best-effort branded email to the client's contact address. Silent when the
   * company has no contact email or the tenant has no SMTP — an alert that can't
   * be sent must never break the sweep.
   */
  private async emailCompany(
    company: { name: string; clientId: string; contactEmail: string | null },
    subject: string,
    body: string,
    phase: 'expiring' | 'expired',
  ) {
    if (!company.contactEmail) return;
    if (!(await this.mailer.isConfigured(company.clientId))) return;
    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;">
        <div style="background:${phase === 'expired' ? '#dc2626' : '#f59e0b'};padding:24px;border-radius:12px 12px 0 0;text-align:center;">
          <h1 style="color:#fff;margin:0;font-size:18px;">${subject}</h1>
        </div>
        <div style="background:#fff;padding:28px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">
          <p style="color:#374151;font-size:14px;">Hi ${company.name},</p>
          <p style="color:#374151;font-size:14px;">${body}</p>
          <p style="color:#6b7280;font-size:12px;">Contact your provider to renew or extend your service.</p>
        </div>
      </div>`;
    try {
      await this.mailer.sendMail({ to: company.contactEmail, subject, html, text: body }, company.clientId);
    } catch { /* best-effort */ }
  }

  private async notifyCompanyAdmins(companyId: string, clientId: string, n: { type: string; title: string; body: string }) {
    const admins = await this.prisma.user.findMany({
      where: { clientId, isActive: true, customerCompanyId: companyId, userRoles: { some: { role: { name: 'CustomerAdmin' } } } },
      select: { id: true },
    });
    await this.notifications.notifyMany(admins.map((a) => a.id), { clientId, ...n });
  }
}
