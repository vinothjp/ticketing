import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAssetAllocationDto, UpdateAssetAllocationDto } from './dto/asset-allocation.dto';
import { OPEN_ALLOCATION_STATUSES, isOpenAllocation, allocationStatusLabel } from './allocation-status';

const day = (v?: string | null) => (v ? new Date(v) : null);

@Injectable()
export class AssetAllocationsService {
  constructor(private prisma: PrismaService) {}

  list(clientId: string, filter: { employeeUserId?: string; assetId?: string; status?: string } = {}) {
    return this.prisma.assetAllocation.findMany({
      where: {
        clientId,
        ...(filter.employeeUserId ? { employeeUserId: filter.employeeUserId } : {}),
        ...(filter.assetId ? { assetId: filter.assetId } : {}),
        ...(filter.status ? { status: filter.status } : {}),
      },
      orderBy: [{ issuedDate: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async findOne(id: string, clientId: string) {
    const row = await this.prisma.assetAllocation.findFirst({ where: { id, clientId } });
    if (!row) throw new NotFoundException('Allocation not found');
    return row;
  }

  async create(clientId: string, dto: CreateAssetAllocationDto, actorId: string) {
    const status = dto.status ?? 'ISSUED';
    const asset = await this.loadAsset(dto.assetId, clientId);
    await this.assertEmployee(dto.employeeUserId, clientId);
    // Check before writing anything — an asset already out must not gain a
    // second holder even for the instant a rolled-back transaction would take.
    if (isOpenAllocation(status)) await this.assertAssetFree(dto.assetId, clientId);

    return this.prisma.assetAllocation.create({
      data: {
        clientId,
        assetId: dto.assetId,
        employeeUserId: dto.employeeUserId,
        status,
        issuedDate: dto.issuedDate === undefined ? new Date() : day(dto.issuedDate),
        returnDate: day(dto.returnDate),
        notes: dto.notes?.trim() || null,
        assetCode: asset.assetId,
        assetName: asset.assetName,
        createdBy: actorId,
        updatedBy: actorId,
      },
    });
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
    if (dto.employeeUserId && dto.employeeUserId !== current.employeeUserId) {
      await this.assertEmployee(dto.employeeUserId, clientId);
    }

    return this.prisma.assetAllocation.update({
      where: { id },
      data: {
        ...(dto.assetId ? { assetId: dto.assetId } : {}),
        ...(asset ? { assetCode: asset.assetId, assetName: asset.assetName } : {}),
        ...(dto.employeeUserId ? { employeeUserId: dto.employeeUserId } : {}),
        ...(dto.status ? { status: dto.status } : {}),
        ...(dto.issuedDate === undefined ? {} : { issuedDate: day(dto.issuedDate) }),
        // Returning an asset stamps the date the admin did not bother to type,
        // so the grid never shows a returned row with an empty return date.
        ...(dto.returnDate === undefined
          ? dto.status === 'RETURNED' && !current.returnDate
            ? { returnDate: new Date() }
            : {}
          : { returnDate: day(dto.returnDate) }),
        ...(dto.notes === undefined ? {} : { notes: dto.notes?.trim() || null }),
        updatedBy: actorId,
      },
    });
  }

  async remove(id: string, clientId: string) {
    await this.findOne(id, clientId);
    await this.prisma.assetAllocation.delete({ where: { id } });
    return { id };
  }

  /**
   * The rule the whole module turns on: an asset is one physical unit, so at most
   * one allocation may hold it at a time. Held is every status except RETURNED —
   * a broken or un-returned laptop is not on the shelf either.
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
    // "issued to X" reads naturally; "broken to X" does not — so the two statuses
    // that hold an asset without it being in active use say so their own way.
    throw new ConflictException(
      held.status === 'ISSUED'
        ? `${asset} is already issued to ${who}${code}`
        : `${asset} is still with ${who}${code}, marked ${allocationStatusLabel(held.status).toLowerCase()}`,
    );
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
      select: { id: true },
    });
    if (!user) throw new BadRequestException('Employee is not a staff user in your organization');
  }
}
