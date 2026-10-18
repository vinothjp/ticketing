import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * The customer-admin rules, as plain functions over Prisma so both the client
 * screen (`CustomerCompaniesService`) and the Users screen (`UsersService`) can
 * hold them without one module importing the other — the same reason
 * `users/user-links.ts` is a file and not a service.
 *
 * A client has **at most one** `CustomerAdmin`. It is a pre-check, not a DB
 * constraint: the role lives in the `UserRole` join table, which no unique
 * index over `User.customerCompanyId` can see.
 */
export const CUSTOMER_ADMIN_ROLE = 'CustomerAdmin';

/** Staff roles a customer-side login must never also hold — `StaffGuard` would lock them out of both. */
const STAFF_ROLES = ['Admin', 'Viewer', 'Manager', 'SuperAdmin'];

/** Display name for a user in a refusal message. */
const who = (u: { name: string | null; username: string }) => u.name?.trim() || u.username;

/** The client's current admin, if any. `exceptUserId` lets a re-save of the same person through. */
export async function currentCustomerAdmin(prisma: PrismaService, companyId: string, exceptUserId?: string) {
  return prisma.user.findFirst({
    where: {
      customerCompanyId: companyId,
      ...(exceptUserId ? { id: { not: exceptUserId } } : {}),
      userRoles: { some: { role: { name: CUSTOMER_ADMIN_ROLE } } },
    },
    select: { id: true, username: true, name: true },
  });
}

/**
 * The provider's Users screen manages its own logins — staff and customer
 * admins. A client's employees (linked, not `CustomerAdmin`) are managed by that
 * client's admin in My Team, so every Users-screen write refuses them.
 */
export async function assertProviderManaged(prisma: PrismaService, userId: string, clientId: string) {
  const user = await prisma.user.findFirst({
    where: { id: userId, clientId },
    select: {
      id: true, customerCompanyId: true,
      customerCompany: { select: { name: true } },
      userRoles: { select: { role: { select: { name: true } } } },
    },
  });
  if (!user) throw new NotFoundException('User not found');
  const isAdmin = user.userRoles.some((ur) => ur.role.name === CUSTOMER_ADMIN_ROLE);
  if (user.customerCompanyId && !isAdmin) {
    throw new ForbiddenException(
      `This user belongs to ${user.customerCompany?.name ?? 'a client'} — their own admin manages them in My Team`,
    );
  }
  return user;
}

/** Refuses a second admin on a client, naming the one it already has. */
export async function assertNoCustomerAdmin(prisma: PrismaService, companyId: string, exceptUserId?: string) {
  const existing = await currentCustomerAdmin(prisma, companyId, exceptUserId);
  if (existing) {
    throw new ConflictException(
      `This client already has a customer admin (${who(existing)}) — a client has only one`,
    );
  }
}

/**
 * Guards a role set the provider's Users screen is about to write.
 *
 * - A user **linked to a client** never takes a staff role — that would make a
 *   client's person a member of the provider's own staff. The only such user the
 *   Users screen manages is the client's admin, and while linked their role is
 *   fixed at `CustomerAdmin`: dropping it would leave the client with no login,
 *   so changing it means unlinking from the client screen first.
 * - An **unlinked** user may hold `CustomerAdmin` (waiting to be linked), but
 *   never beside a staff role — `StaffGuard` would lock them out of both — and
 *   never `Customer`, which is a client's employee and is added by that client's
 *   admin in My Team.
 */
export async function assertProviderRoleSet(
  prisma: PrismaService,
  user: { id: string; customerCompanyId: string | null },
  roleNames: string[],
) {
  if (user.customerCompanyId) {
    if (roleNames.length !== 1 || roleNames[0] !== CUSTOMER_ADMIN_ROLE) {
      throw new BadRequestException(
        `This user is linked to a client, so their only role is ${CUSTOMER_ADMIN_ROLE} — unlink them on the client screen to change it`,
      );
    }
    await assertNoCustomerAdmin(prisma, user.customerCompanyId, user.id);
    return;
  }
  if (roleNames.includes('Customer')) {
    throw new BadRequestException("Customer logins belong to a client and are added by that client's admin in My Team");
  }
  if (roleNames.includes(CUSTOMER_ADMIN_ROLE)) {
    const clash = roleNames.filter((r) => STAFF_ROLES.includes(r));
    if (clash.length) {
      throw new BadRequestException(
        `${CUSTOMER_ADMIN_ROLE} is a client login and cannot be combined with ${clash.join(', ')}`,
      );
    }
  }
}
