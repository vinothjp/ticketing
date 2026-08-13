import { Injectable } from '@nestjs/common';
import { Prisma, CustomerCompany } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from '../mail/mailer.service';
import { NotificationsService } from '../notifications/notifications.service';

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

  /** Consumed vs agreed support hours for a company. `hasPool:false` when no pool is set. */
  async usageForCompany(company: CustomerCompany): Promise<SupportUsage> {
    if (company.agreedSupportHours == null) return { hasPool: false };
    const agreed = Number(company.agreedSupportHours);

    const where: Prisma.TicketWorklogWhereInput = {
      clientId: company.clientId,
      ticket: { customerCompanyId: company.id },
    };
    if (company.supportPeriodStart || company.supportPeriodEnd) {
      const workDate: Prisma.DateTimeFilter = {};
      if (company.supportPeriodStart) workDate.gte = company.supportPeriodStart;
      if (company.supportPeriodEnd) workDate.lte = company.supportPeriodEnd;
      where.workDate = workDate;
    }

    const agg = await this.prisma.ticketWorklog.aggregate({ where, _sum: { hours: true } });
    const used = Number(agg._sum.hours ?? 0);
    const pct = agreed > 0 ? Math.round((used / agreed) * 100) : 0;
    return {
      hasPool: true,
      agreedHours: agreed,
      usedHours: used,
      remainingHours: Math.max(0, agreed - used),
      pct,
      thresholdPct: company.supportAlertThresholdPct,
      periodStart: company.supportPeriodStart,
      periodEnd: company.supportPeriodEnd,
      overThreshold: pct >= company.supportAlertThresholdPct,
    };
  }

  async usageForCompanyId(companyId: string, clientId: string): Promise<SupportUsage> {
    const company = await this.prisma.customerCompany.findFirst({ where: { id: companyId, clientId } });
    if (!company) return { hasPool: false };
    return this.usageForCompany(company);
  }

  /**
   * Recompute a company's usage after time is logged, and fire the "hours running
   * low" alert (in-app + email) once per period when the threshold is first crossed.
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
      const html = `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;">
          <div style="background:#f59e0b;padding:24px;border-radius:12px 12px 0 0;text-align:center;">
            <h1 style="color:#fff;margin:0;font-size:18px;">Support hours running low</h1>
          </div>
          <div style="background:#fff;padding:28px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">
            <p style="color:#374151;font-size:14px;">Hi ${company.name},</p>
            <p style="color:#374151;font-size:14px;">${summary}</p>
            <p style="color:#374151;font-size:14px;">You have <strong>${usage.remainingHours}</strong> hours remaining in the current support period. Please reach out to your provider if you expect to need more.</p>
            <p style="color:#6b7280;font-size:12px;">This is an automated notification sent when usage crosses ${usage.thresholdPct}% of the agreed hours.</p>
          </div>
        </div>`;
      try {
        await this.mailer.sendMail(
          { to: company.contactEmail, subject: `Support hours alert — ${usage.pct}% used`, html, text: summary },
          company.clientId,
        );
      } catch {
        // Alert is best-effort; the in-app notification already went out.
      }
    }
  }
}
