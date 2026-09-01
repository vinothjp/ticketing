import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The audit trail of an asset's life. Same shape as `ActivityService` for
 * tickets: one `log`, one `list`, and every entry written **after** the operation
 * it describes rather than inside its transaction — a failed log must never roll
 * back the allocation it was recording.
 *
 * Keyed on the asset, so the register answers "where has this unit been"; the
 * `employeeUserId` on each row lets the same trail answer "what has this person
 * held" without a second table.
 */
export type AssetActivityType =
  | 'ASSET_CREATED'
  | 'ASSET_UPDATED'
  | 'CONDITION_CHANGED'
  | 'ALLOCATED'
  | 'RETURNED'
  | 'REISSUED'
  | 'REASSIGNED'
  | 'ALLOCATION_UPDATED'
  | 'ALLOCATION_REMOVED';

export interface AssetActivityInput {
  clientId: string;
  assetId: string;
  allocationId?: string | null;
  employeeUserId?: string | null;
  employeeName?: string | null;
  type: AssetActivityType;
  summary: string;
  meta?: Record<string, unknown>;
  actorUserId?: string | null;
  actorName?: string | null;
}

@Injectable()
export class AssetActivityService {
  constructor(private prisma: PrismaService) {}

  /**
   * Records one audit entry. Best-effort: a trail that throws must not take the
   * write it describes down with it, so failures are swallowed rather than
   * propagated — the caller has already committed.
   */
  async log(input: AssetActivityInput) {
    try {
      return await this.prisma.assetActivity.create({
        data: {
          clientId: input.clientId,
          assetId: input.assetId,
          allocationId: input.allocationId ?? null,
          employeeUserId: input.employeeUserId ?? null,
          employeeName: input.employeeName ?? null,
          type: input.type,
          summary: input.summary,
          meta: (input.meta as Prisma.InputJsonValue) ?? Prisma.JsonNull,
          actorUserId: input.actorUserId ?? null,
          actorName: input.actorName ?? null,
        },
      });
    } catch {
      return null;
    }
  }

  async list(
    clientId: string,
    filter: { assetId?: string; employeeUserId?: string; allocationId?: string } = {},
  ) {
    const rows = await this.prisma.assetActivity.findMany({
      where: {
        clientId,
        ...(filter.assetId ? { assetId: filter.assetId } : {}),
        ...(filter.employeeUserId ? { employeeUserId: filter.employeeUserId } : {}),
        ...(filter.allocationId ? { allocationId: filter.allocationId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      // Read live rather than denormalised: a renamed unit reads correctly in
      // its own history, and the employee-scoped view needs the code to tell
      // three "Issued to Ravi Kumar" entries apart.
      include: { asset: { select: { assetId: true, assetName: true } } },
    });

    return rows.map(({ asset, ...r }) => ({
      ...r,
      assetCode: asset?.assetId ?? null,
      assetName: asset?.assetName ?? null,
    }));
  }

  /** The display name for whoever acted — the full name, falling back to the username. */
  async actorName(userId?: string | null) {
    if (!userId) return null;
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, username: true },
    });
    return u?.name || u?.username || null;
  }
}
