import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Blocks a customer CR its client's contract does not allow — the "CR
 * applicable" and "Max CRs per month" contract services set on the client
 * screens. A CR records no product, so:
 *  - one shared contract → that contract's settings;
 *  - per-product contracts → the client's products together: CRs are covered if
 *    any product says so, and the monthly limit is the sum of those products'
 *    limits (any one of them left blank means no limit).
 *
 * A CR stops counting once it is turned down — its status Rejected or Cancelled,
 * or rejected by the customer or the CAB. Internal changes never count. The month
 * is the one the CR was *created* in: `crDate` is editable and could be
 * back-dated around a full month. "Max hours per CR" only makes a CR chargeable,
 * so it blocks nothing here.
 *
 * Plain functions over Prisma, like `customer-companies/module-switch.ts`.
 */

export interface CrLimitState {
  changeSource: string;
  customerCompanyId: string | null;
  status: string;
  approvalStatus: string;
  cabApprovalStatus: string;
}

const TURNED_DOWN_STATUSES = ['rejected', 'cancelled'];

/** Every CR the monthly limit ignores — the query twin of `countsTowardLimit`. */
const NOT_COUNTED: Prisma.ChangeRequestWhereInput = {
  OR: [
    ...TURNED_DOWN_STATUSES.map((s) => ({ status: { equals: s, mode: 'insensitive' as const } })),
    { approvalStatus: 'REJECTED' },
    { cabApprovalStatus: 'REJECTED' },
  ],
};

export function countsTowardLimit(cr: CrLimitState) {
  if (cr.changeSource === 'INTERNAL' || !cr.customerCompanyId) return false;
  if (TURNED_DOWN_STATUSES.includes(cr.status.trim().toLowerCase())) return false;
  return cr.approvalStatus !== 'REJECTED' && cr.cabApprovalStatus !== 'REJECTED';
}

/** Whether a client's contract covers CRs, and how many a month (null = no limit). */
async function crTerms(prisma: PrismaService, clientId: string, customerCompanyId: string) {
  const company = await prisma.customerCompany.findFirst({
    where: { id: customerCompanyId, clientId },
    select: {
      name: true, contractScope: true, contractCrApplicable: true, contractCrMaxPerMonth: true,
      products: { select: { amcCrApplicable: true, amcCrMaxPerMonth: true } },
    },
  });
  if (!company) return null;
  if (company.contractScope === 'CUSTOMER') {
    return { name: company.name, applicable: company.contractCrApplicable, maxPerMonth: company.contractCrMaxPerMonth };
  }
  const covered = company.products.filter((p) => p.amcCrApplicable);
  return {
    name: company.name,
    applicable: covered.length > 0,
    maxPerMonth: covered.some((p) => p.amcCrMaxPerMonth == null)
      ? null
      : covered.reduce((sum, p) => sum + (p.amcCrMaxPerMonth ?? 0), 0),
  };
}

/**
 * Refuse a CR its client's contract does not allow. Runs only when the CR
 * *starts* counting — raised, moved to another client, switched from internal,
 * or brought back from rejected/cancelled — so editing any other field of a CR
 * raised before a limit was lowered is never refused retroactively.
 */
export async function assertCrWithinContract(
  prisma: PrismaService,
  clientId: string,
  before: CrLimitState | null,
  after: CrLimitState,
  opts: { createdAt: Date; excludeId?: string },
) {
  if (!countsTowardLimit(after)) return;
  if (before && countsTowardLimit(before) && before.customerCompanyId === after.customerCompanyId) return;

  const terms = await crTerms(prisma, clientId, after.customerCompanyId!);
  if (!terms) return;
  if (!terms.applicable) {
    throw new BadRequestException(`CRs are not covered by ${terms.name}'s contract.`);
  }
  if (terms.maxPerMonth == null) return;

  const from = new Date(opts.createdAt.getFullYear(), opts.createdAt.getMonth(), 1);
  const to = new Date(opts.createdAt.getFullYear(), opts.createdAt.getMonth() + 1, 1);
  const used = await prisma.changeRequest.count({
    where: {
      clientId,
      customerCompanyId: after.customerCompanyId,
      changeSource: { not: 'INTERNAL' },
      createdAt: { gte: from, lt: to },
      ...(opts.excludeId ? { id: { not: opts.excludeId } } : {}),
      NOT: NOT_COUNTED,
    },
  });
  if (used >= terms.maxPerMonth) {
    const month = from.toLocaleString('en-GB', { month: 'long', year: 'numeric' });
    throw new BadRequestException(
      `${terms.name}'s contract allows ${terms.maxPerMonth} CR${terms.maxPerMonth === 1 ? '' : 's'} a month, and ${month}'s are used up.`,
    );
  }
}
