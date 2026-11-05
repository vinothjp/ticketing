import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Hours are costed at the rate of the logger's category on the project's
 * Resources tab, so only a member holding a category may log time there —
 * anyone else's hours would silently cost nothing. Its own file so both the
 * project Timesheet tab (`ProjectsService`) and the weekly page
 * (`TimesheetService`) share one rule and one message.
 */
export async function costedProjectIds(prisma: PrismaService, userId: string, projectIds?: string[]) {
  const rows = await prisma.projectResource.findMany({
    where: { userId, categoryId: { not: null }, ...(projectIds ? { projectId: { in: projectIds } } : {}) },
    select: { projectId: true },
  });
  return new Set(rows.map((r) => r.projectId));
}

export async function assertCostedMember(prisma: PrismaService, userId: string, projectIds: string[]) {
  if (!projectIds.length) return;
  const ok = await costedProjectIds(prisma, userId, projectIds);
  const missing = projectIds.filter((id) => !ok.has(id));
  if (!missing.length) return;
  const [user, projects] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { username: true } }),
    prisma.project.findMany({ where: { id: { in: missing } }, select: { name: true } }),
  ]);
  throw new BadRequestException(
    `${user?.username ?? 'This consultant'} isn't on the Resources tab of ${projects.map((p) => p.name).join(', ')} with a cost category — add them there before logging time.`,
  );
}
