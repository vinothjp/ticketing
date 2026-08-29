import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAssetDto, UpdateAssetDto } from './dto/asset.dto';
import { OPEN_ALLOCATION_STATUSES } from './allocation-status';

/** `YYYY-MM-DD` (or null/'') from a form date input -> a Date Prisma can store. */
const day = (v?: string | null) => (v ? new Date(v) : null);

@Injectable()
export class AssetsService {
  constructor(private prisma: PrismaService) {}

  /**
   * The register. `available` narrows it to assets nobody is currently holding —
   * what the asset-request dialog on a ticket offers — and `q` is the list
   * screen's search over code / name / serial.
   */
  async list(clientId: string, opts: { q?: string; available?: boolean } = {}) {
    const like = (field: string) => ({ [field]: { contains: opts.q, mode: 'insensitive' as const } });
    const assets = await this.prisma.asset.findMany({
      where: {
        clientId,
        ...(opts.q ? { OR: [like('assetId'), like('assetName'), like('serialNumber')] } : {}),
      },
      orderBy: { assetId: 'asc' },
      include: {
        // The open allocation, if any — one row at most, by the rule
        // AssetAllocationsService enforces. It is what the list's "Allocated to"
        // column and the `available` filter read off.
        allocations: {
          where: { status: { in: OPEN_ALLOCATION_STATUSES } },
          include: { employee: { select: { id: true, name: true, username: true, employeeId: true } } },
          take: 1,
        },
      },
    });

    const rows = assets.map(({ allocations, ...asset }) => {
      const held = allocations[0];
      return {
        ...asset,
        allocation: held
          ? {
              id: held.id,
              status: held.status,
              issuedDate: held.issuedDate,
              employeeUserId: held.employeeUserId,
              employeeName: held.employee?.name || held.employee?.username || null,
              employeeCode: held.employee?.employeeId ?? null,
            }
          : null,
      };
    });

    return opts.available ? rows.filter((a) => !a.allocation) : rows;
  }

  /** Not-found and not-yours both 404 — a foreign tenant's asset stays invisible. */
  async findOne(id: string, clientId: string) {
    const asset = await this.prisma.asset.findFirst({ where: { id, clientId } });
    if (!asset) throw new NotFoundException('Asset not found');
    return asset;
  }

  /**
   * Who has held this asset — the read-only table on the Asset Master screen.
   * Employee facts are read off the live `User` row, so a renamed or transferred
   * employee reads correctly here; only the *asset* side is denormalised.
   */
  async listAllocations(assetId: string, clientId: string) {
    await this.findOne(assetId, clientId);
    const rows = await this.prisma.assetAllocation.findMany({
      where: { assetId, clientId },
      orderBy: [{ issuedDate: 'desc' }, { createdAt: 'desc' }],
      include: {
        employee: {
          select: { id: true, name: true, username: true, employeeId: true, department: true, designation: true },
        },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      issuedDate: r.issuedDate,
      returnDate: r.returnDate,
      employeeUserId: r.employeeUserId,
      employeeCode: r.employee?.employeeId ?? null,
      employeeName: r.employee?.name || r.employee?.username || null,
      department: r.employee?.department ?? null,
      designation: r.employee?.designation ?? null,
    }));
  }

  async create(clientId: string, dto: CreateAssetDto, actorId: string) {
    const assetId = dto.assetId.trim();
    await this.assertCodeFree(clientId, assetId);
    return this.prisma.asset.create({
      data: {
        ...this.writable(dto),
        clientId,
        assetId,
        assetName: dto.assetName.trim(),
        createdBy: actorId,
        updatedBy: actorId,
      },
    });
  }

  async update(id: string, clientId: string, dto: UpdateAssetDto, actorId: string) {
    const asset = await this.findOne(id, clientId);
    const assetId = dto.assetId?.trim();
    if (assetId && assetId !== asset.assetId) await this.assertCodeFree(clientId, assetId, id);

    const updated = await this.prisma.asset.update({
      where: { id },
      data: {
        ...this.writable(dto),
        ...(assetId ? { assetId } : {}),
        ...(dto.assetName ? { assetName: dto.assetName.trim() } : {}),
        updatedBy: actorId,
      },
    });

    // The allocations carry a denormalised copy for their grids — keep it true.
    if (updated.assetId !== asset.assetId || updated.assetName !== asset.assetName) {
      await this.prisma.assetAllocation.updateMany({
        where: { assetId: id },
        data: { assetCode: updated.assetId, assetName: updated.assetName },
      });
    }

    return updated;
  }

  async remove(id: string, clientId: string) {
    await this.findOne(id, clientId);
    // Allocations cascade with the asset; a TicketApproval that requested it
    // keeps its denormalised code/name and simply loses the link (SetNull).
    await this.prisma.asset.delete({ where: { id } });
    return { id };
  }

  /** The asset code identifies one physical unit, so it is unique per tenant. */
  private async assertCodeFree(clientId: string, assetId: string, ignoreId?: string) {
    const clash = await this.prisma.asset.findFirst({
      where: { clientId, assetId, ...(ignoreId ? { NOT: { id: ignoreId } } : {}) },
      select: { assetName: true },
    });
    if (clash) {
      throw new ConflictException(`Asset ID ${assetId} is already used by "${clash.assetName}"`);
    }
  }

  /**
   * The free-text and date columns, with dates parsed. `assetId` / `assetName`
   * are applied by the caller, so create can require them and update can leave
   * them alone. A key the caller never sent stays `undefined` and Prisma skips
   * it; an explicitly emptied box arrives as '' and is stored as null.
   */
  private writable(dto: UpdateAssetDto) {
    const text = (v?: string | null) => (v === undefined ? undefined : v?.trim() || null);
    return {
      description: text(dto.description),
      assetType: text(dto.assetType),
      assetCategory: text(dto.assetCategory),
      serialNumber: text(dto.serialNumber),
      manufacturer: text(dto.manufacturer),
      model: text(dto.model),
      barcode: text(dto.barcode),
      poNumber: text(dto.poNumber),
      supplierName: text(dto.supplierName),
      invoiceNumber: text(dto.invoiceNumber),
      lifespan: text(dto.lifespan),
      warrantyStart: dto.warrantyStart === undefined ? undefined : day(dto.warrantyStart),
      warrantyEnd: dto.warrantyEnd === undefined ? undefined : day(dto.warrantyEnd),
      purchaseDate: dto.purchaseDate === undefined ? undefined : day(dto.purchaseDate),
    };
  }
}
