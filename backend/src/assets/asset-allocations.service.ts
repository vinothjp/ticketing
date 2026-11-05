import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAssetAllocationDto, UpdateAssetAllocationDto } from './dto/asset-allocation.dto';
import {
  OPEN_ALLOCATION_STATUSES, isOpenAllocation, allocationStatusLabel,
  returnConditionLabel, retentionLabel,
} from './allocation-status';
import { AssetActivityService } from './asset-activity.service';

const day = (v?: string | null) => (v ? new Date(v) : null);

/** Field equality for the audit diff — Dates compare by value, not identity. */
const same = (a: unknown, b: unknown) =>
  a instanceof Date || b instanceof Date
    ? (a instanceof Date ? a.getTime() : a) === (b instanceof Date ? b.getTime() : b)
    : a === b;

@Injectable()
export class AssetAllocationsService {
  constructor(
    private prisma: PrismaService,
    private activity: AssetActivityService,
  ) {}

  /**
   * One door for both masters: `employeeUserId` is what the Employee Master grid
   * asks for, `assetId` what the Asset Master one does. They are the same rows,
   * which is what keeps an edit on either screen visible on the other.
   *
   * Employee facts are read off the live `User` row rather than denormalised, so
   * a renamed or transferred employee reads correctly here; only the *asset* side
   * is copied at write time.
   */
  async list(
    clientId: string,
    filter: { employeeUserId?: string; assetId?: string; status?: string } = {},
  ) {
    const rows = await this.prisma.assetAllocation.findMany({
      where: {
        clientId,
        ...(filter.employeeUserId ? { employeeUserId: filter.employeeUserId } : {}),
        ...(filter.assetId ? { assetId: filter.assetId } : {}),
        ...(filter.status ? { status: filter.status } : {}),
      },
      orderBy: [{ issuedDate: 'desc' }, { createdAt: 'desc' }],
      include: {
        employee: {
          select: {
            id: true, name: true, username: true, employeeId: true,
            department: true, designation: true, isActive: true,
          },
        },
      },
    });

    return rows.map(({ employee, ...r }) => ({
      ...r,
      employeeCode: employee?.employeeId ?? null,
      employeeName: employee?.name || employee?.username || null,
      department: employee?.department ?? null,
      designation: employee?.designation ?? null,
      employeeActive: employee?.isActive ?? true,
    }));
  }

  async findOne(id: string, clientId: string) {
    const row = await this.prisma.assetAllocation.findFirst({ where: { id, clientId } });
    if (!row) throw new NotFoundException('Allocation not found');
    return row;
  }

  async create(clientId: string, dto: CreateAssetAllocationDto, actorId: string) {
    const status = dto.status ?? 'ISSUED';
    const asset = await this.loadAsset(dto.assetId, clientId);
    const employee = await this.assertEmployee(dto.employeeUserId, clientId);
    // Check before writing anything — an asset already out must not gain a
    // second holder even for the instant a rolled-back transaction would take.
    if (isOpenAllocation(status)) await this.assertAssetFree(dto.assetId, clientId);

    const retention = dto.retention ?? 'RETURNABLE';
    const row = await this.prisma.assetAllocation.create({
      data: {
        clientId,
        assetId: dto.assetId,
        employeeUserId: dto.employeeUserId,
        status,
        // A condition only means something once the unit is back.
        returnCondition: status === 'RETURNED' ? dto.returnCondition ?? 'GOOD' : null,
        retention,
        // An until-exit holding has no due date by definition, so one sent
        // alongside it is dropped rather than left to read as overdue.
        expectedReturnDate: retention === 'UNTIL_EXIT' ? null : day(dto.expectedReturnDate),
        issuedDate: dto.issuedDate === undefined ? new Date() : day(dto.issuedDate),
        returnDate: day(dto.returnDate),
        notes: dto.notes?.trim() || null,
        assetCode: asset.assetId,
        assetName: asset.assetName,
        createdBy: actorId,
        updatedBy: actorId,
      },
    });

    await this.activity.log({
      clientId,
      assetId: asset.id,
      allocationId: row.id,
      employeeUserId: row.employeeUserId,
      employeeName: employee.displayName,
      type: 'ALLOCATED',
      summary: `Issued to ${employee.displayName}${retention === 'UNTIL_EXIT' ? ' · until exit' : ''}`,
      meta: { retention, status },
      actorUserId: actorId,
      actorName: await this.activity.actorName(actorId),
    });

    return row;
  }

  async update(id: string, clientId: string, dto: UpdateAssetAllocationDto, actorId: string) {
    const current = await this.findOne(id, clientId);
    const assetId = dto.assetId ?? current.assetId;
    const status = dto.status ?? current.status;

    // Re-check availability whenever this row would newly hold an asset: a swap
    // to a different asset, or a settled row being put back into an open status.
    const wouldHold = isOpenAllocation(status);
    const newlyHolds = wouldHold && (assetId !== current.assetId || !isOpenAllocation(current.status));
    if (newlyHolds) await this.assertAssetFree(assetId, clientId, id);

    const asset = dto.assetId && dto.assetId !== current.assetId
      ? await this.loadAsset(dto.assetId, clientId)
      : null;
    const employee = dto.employeeUserId && dto.employeeUserId !== current.employeeUserId
      ? await this.assertEmployee(dto.employeeUserId, clientId)
      : null;

    const returning = status === 'RETURNED' && current.status !== 'RETURNED';
    const reissuing = status === 'ISSUED' && current.status === 'RETURNED';
    const retention = dto.retention ?? current.retention;

    const updated = await this.prisma.assetAllocation.update({
      where: { id },
      data: {
        ...(dto.assetId ? { assetId: dto.assetId } : {}),
        ...(asset ? { assetCode: asset.assetId, assetName: asset.assetName } : {}),
        ...(dto.employeeUserId ? { employeeUserId: dto.employeeUserId } : {}),
        ...(dto.status ? { status: dto.status } : {}),
        // A returned row always carries a condition — GOOD when the caller did
        // not say — and re-opening one clears both the condition and the date,
        // so a re-issued unit never reads as still being back on the shelf.
        ...(returning
          ? { returnCondition: dto.returnCondition ?? 'GOOD' }
          : reissuing
            ? { returnCondition: null, returnDate: null }
            : dto.returnCondition === undefined
              ? {}
              : { returnCondition: status === 'RETURNED' ? dto.returnCondition : null }),
        ...(dto.retention ? { retention: dto.retention } : {}),
        ...(retention === 'UNTIL_EXIT'
          ? { expectedReturnDate: null }
          : dto.expectedReturnDate === undefined
            ? {}
            : { expectedReturnDate: day(dto.expectedReturnDate) }),
        ...(dto.issuedDate === undefined ? {} : { issuedDate: day(dto.issuedDate) }),
        // Returning an asset stamps the date the admin did not bother to type,
        // so the grid never shows a returned row with an empty return date.
        ...(reissuing
          ? {}
          : dto.returnDate === undefined
            ? returning && !current.returnDate
              ? { returnDate: new Date() }
              : {}
            : { returnDate: day(dto.returnDate) }),
        ...(dto.notes === undefined ? {} : { notes: dto.notes?.trim() || null }),
        updatedBy: actorId,
      },
    });

    await this.logUpdate(clientId, current, updated, { returning, reissuing, employee, actorId });
    return updated;
  }

  async remove(id: string, clientId: string) {
    const row = await this.findOne(id, clientId);
    // Logged before the delete: the row's own fields are what the entry names,
    // and `AssetActivity.allocationId` is deliberately not a foreign key so the
    // trail outlives the allocation it describes.
    await this.activity.log({
      clientId,
      assetId: row.assetId,
      allocationId: row.id,
      employeeUserId: row.employeeUserId,
      employeeName: await this.employeeName(row.employeeUserId),
      type: 'ALLOCATION_REMOVED',
      summary: `Allocation removed — ${row.assetCode ?? 'the asset'} is back in the register`,
      meta: { status: row.status },
      actorUserId: null,
      actorName: null,
    });

    await this.prisma.assetAllocation.delete({ where: { id } });
    return { id };
  }

  /**
   * The rule the whole module turns on: an asset is one physical unit, so at most
   * one allocation may hold it at a time. With two statuses, held means ISSUED —
   * damage is now a condition of the unit, not a status that hides it.
   *
   * Pre-check + ConflictException rather than a DB constraint (the house
   * convention, and `db push` on container start would drop the partial index
   * this would otherwise need), and the message names the current holder so the
   * admin knows who to chase.
   */
  async assertAssetFree(assetId: string, clientId: string, ignoreAllocationId?: string) {
    const held = await this.prisma.assetAllocation.findFirst({
      where: {
        assetId,
        clientId,
        status: { in: OPEN_ALLOCATION_STATUSES },
        ...(ignoreAllocationId ? { NOT: { id: ignoreAllocationId } } : {}),
      },
      include: { employee: { select: { name: true, username: true, employeeId: true } } },
    });
    if (!held) return;

    const who = held.employee?.name || held.employee?.username || 'another employee';
    const code = held.employee?.employeeId ? ` (${held.employee.employeeId})` : '';
    const asset = held.assetCode ?? 'This asset';
    throw new ConflictException(
      `${asset} is already ${allocationStatusLabel(held.status).toLowerCase()} to ${who}${code}`,
    );
  }

  /**
   * One entry per thing that actually happened, in the order a person would tell
   * it: the return or re-issue first, then a reassignment, then whatever else
   * changed. A no-op PATCH writes nothing.
   */
  private async logUpdate(
    clientId: string,
    before: { [k: string]: any },
    after: { [k: string]: any },
    ctx: {
      returning: boolean;
      reissuing: boolean;
      employee: { displayName: string } | null;
      actorId: string;
    },
  ) {
    const actorName = await this.activity.actorName(ctx.actorId);
    const employeeName = ctx.employee?.displayName ?? (await this.employeeName(after.employeeUserId));
    const base = {
      clientId,
      assetId: after.assetId as string,
      allocationId: after.id as string,
      employeeUserId: after.employeeUserId as string,
      employeeName,
      actorUserId: ctx.actorId,
      actorName,
    };

    if (ctx.returning) {
      const condition = returnConditionLabel(after.returnCondition);
      await this.activity.log({
        ...base,
        type: 'RETURNED',
        summary: `Returned by ${employeeName} — ${condition}`,
        meta: { returnCondition: after.returnCondition },
      });

      // A broken return damages the *unit*, which outlives this allocation. Never
      // downgrade a RETIRED asset: writing it off is a stronger statement than
      // one bad return.
      if (after.returnCondition === 'BROKEN') {
        const asset = await this.prisma.asset.findUnique({
          where: { id: after.assetId },
          select: { condition: true },
        });
        if (asset?.condition === 'OK') {
          await this.prisma.asset.update({
            where: { id: after.assetId },
            data: { condition: 'DAMAGED' },
          });
          await this.activity.log({
            ...base,
            type: 'CONDITION_CHANGED',
            summary: 'Condition OK → Damaged, from a broken return',
            meta: { from: 'OK', to: 'DAMAGED' },
          });
        }
      }
    }

    if (ctx.reissuing) {
      await this.activity.log({
        ...base,
        type: 'REISSUED',
        summary: `Re-issued to ${employeeName}`,
      });
    }

    if (before.employeeUserId !== after.employeeUserId) {
      await this.activity.log({
        ...base,
        type: 'REASSIGNED',
        summary: `Reassigned to ${employeeName}`,
        meta: { from: before.employeeUserId, to: after.employeeUserId },
      });
    }

    const fields: [string, string][] = [
      ['retention', 'holding'],
      ['expectedReturnDate', 'due-back date'],
      ['issuedDate', 'issued date'],
      ['returnDate', 'return date'],
      ['notes', 'notes'],
    ];
    // The return and re-issue entries already say what those two moved, so their
    // stamped dates are not repeated as a second "changed the return date".
    const skip = new Set(ctx.returning || ctx.reissuing ? ['returnDate', 'returnCondition'] : []);
    const changed = fields.filter(([k]) => !skip.has(k) && !same(before[k], after[k]));
    if (changed.length) {
      const detail = changed
        .map(([k, label]) =>
          k === 'retention' ? `holding ${retentionLabel(after.retention).toLowerCase()}` : `${label} changed`)
        .join(', ');
      await this.activity.log({
        ...base,
        type: 'ALLOCATION_UPDATED',
        summary: detail.charAt(0).toUpperCase() + detail.slice(1),
        meta: Object.fromEntries(changed.map(([k]) => [k, { from: before[k], to: after[k] }])),
      });
    }
  }

  private async employeeName(userId: string) {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, username: true },
    });
    return u?.name || u?.username || 'the employee';
  }

  private async loadAsset(assetId: string, clientId: string) {
    const asset = await this.prisma.asset.findFirst({
      where: { id: assetId, clientId },
      select: { id: true, assetId: true, assetName: true, assetType: true },
    });
    if (!asset) throw new BadRequestException('Asset is not in your organization');
    return asset;
  }

  /** Employees are internal staff — a customer contact is never one. */
  private async assertEmployee(userId: string, clientId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, clientId, customerCompanyId: null },
      select: { id: true, name: true, username: true },
    });
    if (!user) throw new BadRequestException('Employee is not a staff user in your organization');
    return { ...user, displayName: user.name || user.username };
  }
}
