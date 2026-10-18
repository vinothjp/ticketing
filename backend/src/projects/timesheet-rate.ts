import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';

export type TimesheetRate = { costRate: Prisma.Decimal | null; billingRate: Prisma.Decimal | null };
const NO_RATE: TimesheetRate = { costRate: null, billingRate: null };

/**
 * The rates to freeze onto timesheet rows a consultant writes, per project: their
 * category's hourly cost and billing rate on that project's Resources tab, as they
 * stand right now. Stamped at write time and never recomputed, so past hours keep
 * the rate their work was done at. Its own file so the project Timesheet tab
 * (`ProjectsService`) and the weekly page (`TimesheetService`) stamp alike.
 */
export async function timesheetRates(prisma: PrismaService, userId: string, projectIds: string[]) {
  const rows = await prisma.projectResource.findMany({
    where: { userId, projectId: { in: projectIds }, categoryId: { not: null } },
    orderBy: { createdAt: 'asc' }, // latest row wins, as the backfill picks it
    select: { projectId: true, category: { select: { hourlyCost: true, billingRate: true } } },
  });
  const byProject = new Map<string, TimesheetRate>();
  for (const r of rows) {
    if (r.category) byProject.set(r.projectId, { costRate: r.category.hourlyCost, billingRate: r.category.billingRate });
  }
  return (projectId: string): TimesheetRate => byProject.get(projectId) ?? NO_RATE;
}
