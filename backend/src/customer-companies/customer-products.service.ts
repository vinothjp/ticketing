import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { CustomerCompanyProduct } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from '../mail/mailer.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  AssignProductDto, UpdateProductTermsDto, RenewAmcDto, CreateProductRequestDto, GrantRequestDto,
} from './dto/customer-product.dto';

const DAY = 86_400_000;
const monthsAfter = (d: Date, months: number) => {
  const r = new Date(d);
  r.setMonth(r.getMonth() + months);
  return r;
};

@Injectable()
export class CustomerProductsService {
  constructor(
    private prisma: PrismaService,
    private mailer: MailerService,
    private notifications: NotificationsService,
  ) {}

  // ---- coverage maths --------------------------------------------------------

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

  /** Customer-facing view of a purchased product with computed warranty + AMC state. */
  private toView(cp: CustomerCompanyProduct & { product?: { name: string; code: string } | null }) {
    const now = Date.now();
    return {
      id: cp.id,
      productId: cp.productId,
      productName: cp.product?.name ?? null,
      productCode: cp.product?.code ?? null,
      status: cp.status,
      purchaseDate: cp.purchaseDate,
      warranty: {
        months: cp.warrantyMonths,
        end: cp.warrantyEnd,
        daysLeft: this.daysLeft(cp.warrantyEnd),
        pct: this.pctElapsed(cp.purchaseDate, cp.warrantyEnd),
        active: cp.warrantyEnd ? cp.warrantyEnd.getTime() > now : false,
      },
      amc: {
        type: cp.amcType,
        start: cp.amcStart,
        end: cp.amcEnd,
        daysLeft: this.daysLeft(cp.amcEnd),
        pct: this.pctElapsed(cp.amcStart, cp.amcEnd),
        active: cp.amcEnd ? cp.amcEnd.getTime() > now : false,
        monthlyCost: cp.amcMonthlyCost == null ? null : Number(cp.amcMonthlyCost),
        hoursPerMonth: cp.amcHoursPerMonth,
        visitsPerMonth: cp.amcVisitsPerMonth,
        freeMonths: cp.freeAmcMonths,
      },
    };
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

    const purchaseDate = dto.purchaseDate ? new Date(dto.purchaseDate) : new Date();
    const warrantyMonths = dto.warrantyMonths ?? 12;
    const freeAmcMonths = dto.freeAmcMonths ?? 12;
    const data = {
      status: 'ACTIVE',
      purchaseDate,
      warrantyMonths,
      warrantyEnd: monthsAfter(purchaseDate, warrantyMonths),
      freeAmcMonths,
      amcType: 'FREE',
      amcStart: purchaseDate,
      amcEnd: monthsAfter(purchaseDate, freeAmcMonths),
      amcMonthlyCost: dto.amcMonthlyCost ?? null,
      amcHoursPerMonth: dto.amcHoursPerMonth ?? null,
      amcVisitsPerMonth: dto.amcVisitsPerMonth ?? 2,
      expiryAlertSentAt: null,
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
    const purchaseDate = dto.purchaseDate ? new Date(dto.purchaseDate) : cp.purchaseDate ?? new Date();
    const warrantyMonths = dto.warrantyMonths ?? cp.warrantyMonths;
    const freeAmcMonths = dto.freeAmcMonths ?? cp.freeAmcMonths;
    // Recompute the free-AMC window from purchase; paid renewals are left alone.
    const recomputeAmc = cp.amcType === 'FREE';
    return this.prisma.customerCompanyProduct.update({
      where: { id: cpId },
      data: {
        purchaseDate,
        warrantyMonths,
        warrantyEnd: monthsAfter(purchaseDate, warrantyMonths),
        freeAmcMonths,
        ...(recomputeAmc ? { amcStart: purchaseDate, amcEnd: monthsAfter(purchaseDate, freeAmcMonths), status: 'ACTIVE', expiryAlertSentAt: null } : {}),
        ...(dto.amcMonthlyCost !== undefined ? { amcMonthlyCost: dto.amcMonthlyCost } : {}),
        ...(dto.amcHoursPerMonth !== undefined ? { amcHoursPerMonth: dto.amcHoursPerMonth } : {}),
        ...(dto.amcVisitsPerMonth !== undefined ? { amcVisitsPerMonth: dto.amcVisitsPerMonth } : {}),
      },
    });
  }

  /** Renew into a paid AMC period from today; reactivates a terminated product. */
  async renewAmc(cpId: string, dto: RenewAmcDto, clientId: string) {
    const cp = await this.ownedCp(cpId, clientId);
    const start = new Date();
    const updated = await this.prisma.customerCompanyProduct.update({
      where: { id: cpId },
      data: {
        status: 'ACTIVE',
        amcType: 'PAID',
        amcStart: start,
        amcEnd: monthsAfter(start, dto.months),
        amcMonthlyCost: dto.amcMonthlyCost ?? cp.amcMonthlyCost,
        amcHoursPerMonth: dto.amcHoursPerMonth ?? cp.amcHoursPerMonth,
        amcVisitsPerMonth: dto.amcVisitsPerMonth ?? cp.amcVisitsPerMonth,
        expiryAlertSentAt: null,
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
    await this.ownedCp(cpId, clientId);
    await this.prisma.customerCompanyProduct.delete({ where: { id: cpId } });
    return { message: 'Product removed from company' };
  }

  async listCompanyProducts(companyId: string, clientId: string) {
    await this.ownedCompany(companyId, clientId);
    const rows = await this.prisma.customerCompanyProduct.findMany({
      where: { customerCompanyId: companyId },
      include: { product: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => this.toView(r));
  }

  // ---- customer: my products, catalogue, requests ----------------------------

  async listMyProducts(clientId: string, companyId: string) {
    const rows = await this.prisma.customerCompanyProduct.findMany({
      where: { customerCompanyId: companyId, customerCompany: { clientId } },
      include: { product: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => this.toView(r));
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
    return { scanned: active.length };
  }

  private async fireCoverageAlert(
    cp: CustomerCompanyProduct & { product?: { name: string } | null; customerCompany?: { id: string; name: string; clientId: string; contactEmail: string | null } | null },
    phase: 'expiring' | 'expired',
  ) {
    const company = cp.customerCompany;
    if (!company) return;
    const name = cp.product?.name ?? 'your product';
    const subject = phase === 'expired'
      ? `Service terminated for ${name}`
      : `AMC / warranty running out for ${name}`;
    const body = phase === 'expired'
      ? `The AMC for ${name} has ended and service is now paused. Renew to continue raising tickets.`
      : `The AMC for ${name} is almost over. Renew to keep your service and warranty support running.`;

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
