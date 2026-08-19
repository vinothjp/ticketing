import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { CustomerCompanyProduct, CustomerCompany } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from '../mail/mailer.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  AssignProductDto, UpdateProductTermsDto, RenewAmcDto, CreateProductRequestDto, GrantRequestDto, SetContractDto,
  RenewContractDto, AddCustomerConsultantDto,
} from './dto/customer-product.dto';

const DAY = 86_400_000;
const monthsAfter = (d: Date, months: number) => {
  const r = new Date(d);
  r.setMonth(r.getMonth() + months);
  return r;
};
// Rough whole-month span between two dates, for the display "months" fields.
const monthsBetween = (start: Date, end: Date) =>
  Math.max(1, Math.round((end.getTime() - start.getTime()) / (30.44 * DAY)));

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

  /** Customer-facing view: warranty + AMC countdowns, live hours/visits left, agents. */
  private toView(
    cp: CustomerCompanyProduct & { product?: { name: string; code: string } | null },
    agents: string[] = [],
  ) {
    const now = Date.now();
    const paid = cp.amcType === 'PAID';
    // Active pool = paid allocation once subscribed, else the free-period allocation.
    const allocHours = paid ? cp.paidAmcHours : cp.freeAmcHours;
    const allocVisits = paid ? cp.paidAmcVisits : cp.freeAmcVisits;
    const hoursUsed = Number(cp.hoursUsed);
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
        allocated: allocHours,
        used: hoursUsed,
        left: allocHours == null ? null : Math.max(0, allocHours - hoursUsed),
      },
      visits: {
        allocated: allocVisits,
        used: cp.visitsUsed,
        left: allocVisits == null ? null : Math.max(0, allocVisits - cp.visitsUsed),
      },
      // Paid-AMC terms shown so the customer knows what a subscription buys.
      paidTerms: {
        months: cp.paidAmcMonths,
        monthlyCost: cp.amcMonthlyCost == null ? null : Number(cp.amcMonthlyCost),
        hours: cp.paidAmcHours,
        visits: cp.paidAmcVisits,
      },
    };
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

  // ---- provider: assign / edit / renew / remove ------------------------------

  async assignProduct(companyId: string, dto: AssignProductDto, clientId: string) {
    await this.ownedCompany(companyId, clientId);
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
      freeAmcHours: paid ? null : dto.supportHours ?? null,
      freeAmcVisits: paid ? null : dto.visits ?? null,
      paidAmcHours: paid ? dto.supportHours ?? null : null,
      paidAmcVisits: paid ? dto.visits ?? null : null,
      hoursUsed: 0,
      visitsUsed: 0,
      expiryAlertSentAt: null,
      warrantyAlertSentAt: null,
    };
    return this.prisma.customerCompanyProduct.upsert({
      where: { customerCompanyId_productId: { customerCompanyId: companyId, productId: dto.productId } },
      update: data,
      create: { customerCompanyId: companyId, productId: dto.productId, ...data },
    });
  }


  private async ownedCp(cpId: string, clientId: string) {
    const cp = await this.prisma.customerCompanyProduct.findFirst({
      where: { id: cpId, customerCompany: { clientId } },
      include: { product: true },
    });
    if (!cp) throw new NotFoundException('Customer product not found');
    return cp;
  }

  async updateTerms(cpId: string, dto: UpdateProductTermsDto, clientId: string) {
    const cp = await this.ownedCp(cpId, clientId);
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
    return this.prisma.customerCompanyProduct.update({
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
        ...(switched ? { hoursUsed: 0, visitsUsed: 0 } : {}),
        ...(paid
          ? {
              ...(dto.contractAmount !== undefined ? { amcMonthlyCost: dto.contractAmount } : {}),
              ...(dto.supportHours !== undefined ? { paidAmcHours: dto.supportHours } : {}),
              ...(dto.visits !== undefined ? { paidAmcVisits: dto.visits } : {}),
            }
          : {
              ...(dto.supportHours !== undefined ? { freeAmcHours: dto.supportHours } : {}),
              ...(dto.visits !== undefined ? { freeAmcVisits: dto.visits } : {}),
            }),
      },
    });
  }

  /** Log support-hours / a site visit used against the current AMC period. */
  async logUsage(cpId: string, dto: { hours?: number; visits?: number }, clientId: string) {
    const cp = await this.ownedCp(cpId, clientId);
    const updated = await this.prisma.customerCompanyProduct.update({
      where: { id: cpId },
      data: {
        hoursUsed: { increment: dto.hours ?? 0 },
        visitsUsed: { increment: dto.visits ?? 0 },
      },
      include: { product: true },
    });
    // Warn when the current pool crosses ~85% used.
    const paid = updated.amcType === 'PAID';
    const allocHours = paid ? updated.paidAmcHours : updated.freeAmcHours;
    if (allocHours && Number(updated.hoursUsed) >= allocHours * 0.85) {
      await this.notifyCompanyAdmins(updated.customerCompanyId, clientId, {
        type: 'PRODUCT_AMC', title: 'Support hours running low',
        body: `You've used ${Number(updated.hoursUsed)} of ${allocHours} support hours for ${updated.product?.name}.`,
      });
    }
    return updated;
  }

  /** Renew into a paid AMC period from today; reactivates a terminated product. */
  async renewAmc(cpId: string, dto: RenewAmcDto, clientId: string) {
    const cp = await this.ownedCp(cpId, clientId);
    const start = new Date();
    const months = dto.months ?? cp.paidAmcMonths ?? 12;
    const updated = await this.prisma.customerCompanyProduct.update({
      where: { id: cpId },
      data: {
        status: 'ACTIVE',
        amcType: 'PAID',
        amcStart: start,
        amcEnd: monthsAfter(start, months),
        paidAmcMonths: months,
        amcMonthlyCost: dto.amcMonthlyCost ?? cp.amcMonthlyCost,
        paidAmcHours: dto.amcHoursPerMonth ?? cp.paidAmcHours,
        paidAmcVisits: dto.amcVisitsPerMonth ?? cp.paidAmcVisits,
        // New paid period → fresh pools.
        hoursUsed: 0,
        visitsUsed: 0,
        expiryAlertSentAt: null,
        warrantyAlertSentAt: cp.warrantyAlertSentAt,
      },
      include: { product: true },
    });
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
    return { message: 'Product removed from company' };
  }

  // ---- contract scope (product-specific vs one shared customer contract) -----

  /** Live view of a shared customer contract: period, hours + visits used/left. */
  private contractView(c: CustomerCompany) {
    const now = Date.now();
    const hoursUsed = Number(c.contractHoursUsed);
    return {
      scope: c.contractScope,
      coverageType: c.contractCoverageType,
      start: c.contractStart,
      end: c.contractEnd,
      hours: c.contractHours,
      visits: c.contractVisits,
      monthlyCost: c.contractMonthlyCost == null ? null : Number(c.contractMonthlyCost),
      period: {
        pct: this.pctElapsed(c.contractStart, c.contractEnd),
        daysLeft: this.daysLeft(c.contractEnd),
        active: c.contractEnd ? c.contractEnd.getTime() > now : true,
      },
      hoursPool: {
        allocated: c.contractHours, used: hoursUsed,
        left: c.contractHours == null ? null : Math.max(0, c.contractHours - hoursUsed),
      },
      visitsPool: {
        allocated: c.contractVisits, used: c.contractVisitsUsed,
        left: c.contractVisits == null ? null : Math.max(0, c.contractVisits - c.contractVisitsUsed),
      },
    };
  }

  async getContract(companyId: string, clientId: string) {
    const c = await this.ownedCompany(companyId, clientId);
    const links = await this.prisma.customerCompanyProduct.findMany({ where: { customerCompanyId: companyId }, select: { productId: true } });
    return { ...this.contractView(c), productIds: links.map((l) => l.productId) };
  }

  async setContract(companyId: string, dto: SetContractDto, clientId: string) {
    const company = await this.ownedCompany(companyId, clientId);

    if (dto.scope === 'CUSTOMER') {
      if (dto.start && dto.end) this.assertRange(new Date(dto.start), new Date(dto.end));
      // A warranty period is free, so it never carries a contract amount.
      const coverageType = dto.coverageType ?? company.contractCoverageType;
      await this.prisma.customerCompany.update({
        where: { id: companyId },
        data: {
          contractScope: 'CUSTOMER',
          ...(dto.coverageType ? { contractCoverageType: dto.coverageType } : {}),
          contractStart: dto.start ? new Date(dto.start) : null,
          contractEnd: dto.end ? new Date(dto.end) : null,
          contractHours: dto.hours ?? null,
          contractVisits: dto.visits ?? null,
          contractMonthlyCost: coverageType === 'AMC' ? (dto.monthlyCost ?? null) : null,
          contractAlertSentAt: null, // re-arm the "running low" alert on any change
        },
      });
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
    return this.getContract(companyId, clientId);
  }

  /** Contract view for the signed-in customer (drives their My Products layout). */
  async myContract(companyId: string, clientId: string) {
    const c = await this.prisma.customerCompany.findFirst({ where: { id: companyId, clientId } });
    if (!c) return { scope: 'PRODUCT' as const };
    return this.contractView(c);
  }

  /** Log support hours / a site visit against the shared customer contract pool. */
  async logContractUsage(companyId: string, dto: { hours?: number; visits?: number }, clientId: string) {
    await this.ownedCompany(companyId, clientId);
    const c = await this.prisma.customerCompany.update({
      where: { id: companyId },
      data: { contractHoursUsed: { increment: dto.hours ?? 0 }, contractVisitsUsed: { increment: dto.visits ?? 0 } },
    });
    if (c.contractHours && Number(c.contractHoursUsed) >= c.contractHours * 0.85 && !c.contractAlertSentAt) {
      await this.prisma.customerCompany.update({ where: { id: companyId }, data: { contractAlertSentAt: new Date() } });
      await this.notifyCompanyAdmins(companyId, clientId, {
        type: 'CONTRACT', title: 'Support hours running low',
        body: `You've used ${Number(c.contractHoursUsed)} of ${c.contractHours} contracted support hours.`,
      });
    }
    return this.contractView(c);
  }

  /** Renew the customer contract into a fresh period (resets used hours/visits). */
  async renewContract(companyId: string, dto: RenewContractDto, clientId: string) {
    const c = await this.ownedCompany(companyId, clientId);
    const start = new Date();
    const updated = await this.prisma.customerCompany.update({
      where: { id: companyId },
      data: {
        contractScope: 'CUSTOMER',
        contractStart: start,
        contractEnd: monthsAfter(start, dto.months),
        contractHours: dto.hours ?? c.contractHours,
        contractVisits: dto.visits ?? c.contractVisits,
        contractMonthlyCost:
          c.contractCoverageType === 'AMC' ? (dto.monthlyCost ?? c.contractMonthlyCost) : null,
        contractHoursUsed: 0,
        contractVisitsUsed: 0,
        contractAlertSentAt: null,
      },
    });
    await this.notifyCompanyAdmins(companyId, clientId, {
      type: 'CONTRACT', title: 'Support contract renewed',
      body: `Your support contract is active until ${updated.contractEnd?.toDateString()}.`,
    });
    return this.contractView(updated);
  }

  async listCompanyProducts(companyId: string, clientId: string) {
    await this.ownedCompany(companyId, clientId);
    const [rows, agents] = await Promise.all([
      this.prisma.customerCompanyProduct.findMany({ where: { customerCompanyId: companyId }, include: { product: true }, orderBy: { createdAt: 'asc' } }),
      this.agentsByProduct(companyId, clientId),
    ]);
    return rows.map((r) => this.toView(r, agents.byProduct.get(r.productId) ?? agents.defaults));
  }

  // ---- customer: my products, catalogue, requests ----------------------------

  async listMyProducts(clientId: string, companyId: string) {
    const [rows, agents] = await Promise.all([
      this.prisma.customerCompanyProduct.findMany({ where: { customerCompanyId: companyId, customerCompany: { clientId } }, include: { product: true }, orderBy: { createdAt: 'asc' } }),
      this.agentsByProduct(companyId, clientId),
    ]);
    return rows.map((r) => this.toView(r, agents.byProduct.get(r.productId) ?? agents.defaults));
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
   * Pick a customer-level consultant override for a ticket, most specific first:
   * product+module(+track) → product+module → the customer's default. Returns a
   * userId only when the user is still active. Null means "use module routing".
   */
  async resolveCustomerConsultant(
    clientId: string, customerCompanyId: string | null,
    productId: string | null, moduleId: string | null, track: 'TECHNICAL' | 'FUNCTIONAL' | null,
  ): Promise<string | null> {
    if (!customerCompanyId) return null;
    const rows = await this.prisma.customerConsultant.findMany({ where: { clientId, customerCompanyId } });
    if (!rows.length) return null;

    const scoped = rows.filter((r) => r.productId && r.productId === productId && r.moduleId === moduleId);
    // Contract-level common consultants (no product/module) handle every covered
    // product; match the ticket's track first, then a track-less catch-all.
    const contract = rows.filter((r) => !r.productId && !r.moduleId);
    // Within a matching cell, the primary agent wins.
    const byPrimary = (a: typeof rows[number], b: typeof rows[number]) => Number(b.isPrimary) - Number(a.isPrimary);
    const pick =
      scoped.filter((r) => r.track && r.track === track).sort(byPrimary)[0]     // module + exact track
      ?? scoped.filter((r) => !r.track).sort(byPrimary)[0]                       // module, any track
      ?? contract.filter((r) => r.track && r.track === track).sort(byPrimary)[0] // contract common, exact track
      ?? contract.filter((r) => !r.track).sort(byPrimary)[0];                    // contract common, any track
    if (!pick) return null;

    const user = await this.prisma.user.findFirst({ where: { id: pick.userId, clientId, isActive: true }, select: { id: true } });
    return user?.id ?? null;
  }

  // ---- expiry sweep (called by the timer) ------------------------------------

  /**
   * Fire the "coverage running out" alert at >= 90% of the AMC period (once),
   * and terminate service (block new tickets) once the AMC has fully lapsed.
   */
  async runExpirySweep() {
    const active = await this.prisma.customerCompanyProduct.findMany({
      where: { status: 'ACTIVE', amcEnd: { not: null } },
      include: { product: true, customerCompany: { select: { id: true, name: true, clientId: true, contactEmail: true } } },
    });
    const now = Date.now();
    for (const cp of active) {
      if (!cp.amcEnd) continue;
      const pct = this.pctElapsed(cp.amcStart, cp.amcEnd);
      const lapsed = cp.amcEnd.getTime() <= now;

      if (lapsed) {
        await this.prisma.customerCompanyProduct.update({ where: { id: cp.id }, data: { status: 'EXPIRED' } });
        await this.fireCoverageAlert(cp, 'expired');
      } else if (pct >= 90 && !cp.expiryAlertSentAt) {
        await this.prisma.customerCompanyProduct.update({ where: { id: cp.id }, data: { expiryAlertSentAt: new Date() } });
        await this.fireCoverageAlert(cp, 'expiring');
      }

    }

    // Shared customer contracts: alert once when the period is >= 90% elapsed.
    const contracts = await this.prisma.customerCompany.findMany({
      where: { contractScope: 'CUSTOMER', contractEnd: { not: null }, contractAlertSentAt: null },
      select: { id: true, name: true, clientId: true, contractStart: true, contractEnd: true },
    });
    for (const c of contracts) {
      const pct = this.pctElapsed(c.contractStart, c.contractEnd);
      if (pct >= 90) {
        await this.prisma.customerCompany.update({ where: { id: c.id }, data: { contractAlertSentAt: new Date() } });
        await this.notifyCompanyAdmins(c.id, c.clientId, {
          type: 'CONTRACT', title: 'Support contract ending soon',
          body: `Your support contract ends on ${c.contractEnd?.toDateString()}. Renew to keep service running.`,
        });
      }
    }
    return { scanned: active.length, contracts: contracts.length };
  }

  private async fireCoverageAlert(
    cp: CustomerCompanyProduct & { product?: { name: string } | null; customerCompany?: { id: string; name: string; clientId: string; contactEmail: string | null } | null },
    phase: 'expiring' | 'expired',
  ) {
    const company = cp.customerCompany;
    if (!company) return;
    const name = cp.product?.name ?? 'your product';
    const cover = cp.amcType === 'FREE' ? 'Warranty' : 'AMC';   // FREE = under warranty
    const subject = phase === 'expired'
      ? `${cover} ended for ${name}`
      : `${cover} running out for ${name}`;
    const body = phase === 'expired'
      ? (cp.amcType === 'FREE'
          ? `The warranty for ${name} has ended — start a paid AMC to keep service running.`
          : `The AMC for ${name} has ended and service is now paused. Renew to continue.`)
      : (cp.amcType === 'FREE'
          ? `The warranty for ${name} is almost over — after it, a paid AMC begins.`
          : `The AMC for ${name} is almost over. Renew to keep service running.`);

    await this.notifyCompanyAdmins(company.id, company.clientId, { type: 'PRODUCT_AMC', title: subject, body });

    if (company.contactEmail && (await this.mailer.isConfigured(company.clientId))) {
      const html = `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;">
          <div style="background:${phase === 'expired' ? '#dc2626' : '#f59e0b'};padding:24px;border-radius:12px 12px 0 0;text-align:center;">
            <h1 style="color:#fff;margin:0;font-size:18px;">${subject}</h1>
          </div>
          <div style="background:#fff;padding:28px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">
            <p style="color:#374151;font-size:14px;">Hi ${company.name},</p>
            <p style="color:#374151;font-size:14px;">${body}</p>
            <p style="color:#6b7280;font-size:12px;">Contact your provider to add or renew service for this product.</p>
          </div>
        </div>`;
      try {
        await this.mailer.sendMail({ to: company.contactEmail, subject, html, text: body }, company.clientId);
      } catch { /* best-effort */ }
    }
  }

  private async notifyCompanyAdmins(companyId: string, clientId: string, n: { type: string; title: string; body: string }) {
    const admins = await this.prisma.user.findMany({
      where: { clientId, isActive: true, customerCompanyId: companyId, userRoles: { some: { role: { name: 'CustomerAdmin' } } } },
      select: { id: true },
    });
    await this.notifications.notifyMany(admins.map((a) => a.id), { clientId, ...n });
  }
}
