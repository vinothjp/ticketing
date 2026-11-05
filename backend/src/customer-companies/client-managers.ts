import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * A client's account manager and each client-product's product manager are one
 * internal staff user apiece. Plain functions in their own file so both
 * `CustomerCompaniesService` and `CustomerProductsService` hold the same rule.
 */

/** Refuse anyone but an active internal staff user of this tenant. */
export async function assertAssignableManager(prisma: PrismaService, userId: string, clientId: string, role: string) {
  const u = await prisma.user.findFirst({ where: { id: userId, clientId, customerCompanyId: null }, select: { isActive: true } });
  if (!u) throw new BadRequestException(`The ${role} must be an internal staff user of this tenant`);
  if (!u.isActive) throw new BadRequestException(`That user is deactivated and can't be made ${role}`);
}

/** How a manager is named on screen — full name, falling back to the username. */
export const managerName = (u: { name: string | null; username: string } | null | undefined) =>
  u ? u.name?.trim() || u.username : null;

export const MANAGER_SELECT = { select: { name: true, username: true } } as const;
