import { Injectable } from '@nestjs/common';
import { Prisma, CustomerCompany } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from '../mail/mailer.service';
import { NotificationsService } from '../notifications/notifications.service';
import { portalLink, renderLetter } from '../lib/letter-email';

export type SupportUsage =
  | { hasPool: false }
  | {
      hasPool: true;
      agreedHours: number;
      usedHours: number;
      remainingHours: number;
      pct: number;
      thresholdPct: number;
      periodStart: Date | null;
      periodEnd: Date | null;
      overThreshold: boolean;
    };

@Injectable()
export class SupportHoursService {
  constructor(
    private prisma: PrismaService,
    private mailer: MailerService,
    private notifications: NotificationsService,
  ) {}

  /**
   * A company-wide support-hours figure, reported from the pool the customer's
   * coverage scope actually uses.
   *
   * Only a shared customer contract HAS a company-wide pool. Under per-product
   * coverage each product carries its own pool, so there is no single company
   * total to report and this answers `hasPool:false` — the per-product figures
   * come from `CustomerProductsService.productSupportHours` instead.
   *
   * The legacy `agreedSupportHours` / `supportPeriod*` columns are deliberately
   * NOT read here: they belong to neither scope, so reporting them let a customer
   * see (and be alerted on) a pool that governs nothing. They remain on the model
   * and the DTO as dormant data — see CLAUDE.md.
   */
  async usageForCompany(company: CustomerCompany): Promise<SupportUsage> {
    if (company.contractScope !== 'CUSTOMER' || company.clientType !== 'AMC') return { hasPool: false };
    if (company.contractHoursUnlimited || company.contractHours == null) return { hasPool: false };
    const agreed = Number(company.contractHours);

    // Same two sources the contract view shows: usage logged straight against the
    // pool, plus time consultants logged on this company's tickets in the period.
    const where: Prisma.TicketWorklogWhereInput = {
      clientId: company.clientId,
      ticket: { customerCompanyId: company.id },
    };
    if (company.contractStart || company.contractEnd) {
      const workDate: Prisma.DateTimeFilter = {};
      if (company.contractStart) workDate.gte = company.contractStart;
      if (company.contractEnd) workDate.lte = company.contractEnd;
      where.workDate = workDate;
    }

    const agg = await this.prisma.ticketWorklog.aggregate({ where, _sum: { hours: true } });
    const used = Number(company.contractHoursUsed) + Number(agg._sum.hours ?? 0);
    const pct = agreed > 0 ? Math.round((used / agreed) * 100) : 0;
    return {
      hasPool: true,
      agreedHours: agreed,
      usedHours: used,
      remainingHours: Math.max(0, agreed - used),
      pct,
      thresholdPct: company.supportAlertThresholdPct,
      periodStart: company.contractStart,
      periodEnd: company.contractEnd,
      overThreshold: pct >= company.supportAlertThresholdPct,
    };
  }

  async usageForCompanyId(companyId: string, clientId: string): Promise<SupportUsage> {
    const company = await this.prisma.customerCompany.findFirst({ where: { id: companyId, clientId } });
    if (!company) return { hasPool: false };
    return this.usageForCompany(company);
  }

  /**
   * Recompute a company's usage and fire the "hours running low" alert (in-app +
   * email) once per period when the threshold is first crossed.
   *
   * No longer called on the ticket-worklog path — that alert is raised by
   * `CustomerProductsService.alertOnLoggedHours`, which measures against the
   * ticket's own product pool under per-product coverage. This remains for
   * callers that want the company-wide contract figure.
   */
  async recomputeAndAlert(companyId: string | null | undefined, clientId: string) {
    if (!companyId) return;
    const company = await this.prisma.customerCompany.findFirst({ where: { id: companyId, clientId } });
    if (!company) return;
    const usage = await this.usageForCompany(company);
    if (!usage.hasPool || !usage.overThreshold || company.supportAlertSentAt) return;

    await this.fireAlert(company, usage);
    await this.prisma.customerCompany.update({
      where: { id: company.id },
      data: { supportAlertSentAt: new Date() },
    });
  }

  private async fireAlert(
    company: CustomerCompany,
    usage: Extract<SupportUsage, { hasPool: true }>,
  ) {
    const summary = `You have used ${usage.usedHours} of ${usage.agreedHours} agreed support hours (${usage.pct}%).`;

    // In-app: the company's own admins.
    const admins = await this.prisma.user.findMany({
      where: {
        clientId: company.clientId, isActive: true, customerCompanyId: company.id,
        userRoles: { some: { role: { name: 'CustomerAdmin' } } },
      },
      select: { id: true },
    });
    await this.notifications.notifyMany(admins.map((a) => a.id), {
      clientId: company.clientId,
      type: 'SUPPORT_HOURS',
      title: 'Support hours running low',
      body: summary,
    });

    // Email: the company's contact address (best-effort — never block on SMTP).
    if (company.contactEmail && (await this.mailer.isConfigured(company.clientId))) {
      const org = await this.prisma.client.findUnique({ where: { id: company.clientId }, select: { name: true } }).catch(() => null);
      const { html, text } = renderLetter({
        greetName: company.name,
        intro: `This is to inform you that ${usage.pct}% of your agreed support hours for the current support period have been used.\n` +
          'Please plan your upcoming support requests accordingly.',
        table: {
          heading: 'Support Hours Details',
          rows: [
            ['Agreed Hours', String(usage.agreedHours)],
            ['Hours Used', String(usage.usedHours)],
            ['Hours Remaining', String(usage.remainingHours)],
            ['Usage', `${usage.pct}%`],
          ],
        },
        outro: `This notification is sent when usage crosses ${usage.thresholdPct}% of the agreed hours. ` +
          'If you expect to need more support hours, please contact us to extend your service.',
        link: { label: 'View My Products', url: portalLink('/my-products') },
        thanks: 'Thank you for choosing our support services.',
        orgName: org?.name,
      });
      try {
        await this.mailer.sendMail(
          { to: company.contactEmail, subject: `[Support Hours Alert] - ${usage.pct}% used`, html, text },
          company.clientId,
        );
      } catch {
        // Alert is best-effort; the in-app notification already went out.
      }
    }
  }
}
