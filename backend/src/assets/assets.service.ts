import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAssetDto, UpdateAssetDto } from './dto/asset.dto';
import {
  OPEN_ALLOCATION_STATUSES, assetConditionLabel,
  ASSET_CONDITIONS, ASSET_CONDITION_LABELS,
} from './allocation-status';
import { AssetActivityService } from './asset-activity.service';
import { ASSET_COLUMNS, ASSET_IMPORT_NOTES } from './asset-sheet';
import type { AssetSheetRow } from './asset-sheet';
import {
  exportSheet, importTemplate, readSheet, rowReader, asText, asDate, asEnum, errorText,
} from '../lib/spreadsheet';
import type { ImportResult, SheetColumn } from '../lib/spreadsheet';

/** `YYYY-MM-DD` (or null/'') from a form date input -> a Date Prisma can store. */
const day = (v?: string | null) => (v ? new Date(v) : null);

/** Field equality for the audit diff — Dates compare by value, not identity. */
const same = (a: unknown, b: unknown) =>
  a instanceof Date || b instanceof Date
    ? (a instanceof Date ? a.getTime() : a) === (b instanceof Date ? b.getTime() : b)
    : a === b;

/** The descriptive fields an ASSET_UPDATED entry names when they change. */
const TRACKED_FIELDS: { key: keyof UpdateAssetDto; label: string }[] = [
  { key: 'assetId', label: 'Asset ID' },
  { key: 'assetName', label: 'Asset name' },
  { key: 'assetType', label: 'Type' },
  { key: 'assetCategory', label: 'Category' },
  { key: 'serialNumber', label: 'Serial number' },
  { key: 'manufacturer', label: 'Manufacturer' },
  { key: 'model', label: 'Model' },
  { key: 'barcode', label: 'Barcode' },
  { key: 'description', label: 'Description' },
  { key: 'poNumber', label: 'PO number' },
  { key: 'supplierName', label: 'Supplier' },
  { key: 'invoiceNumber', label: 'Invoice number' },
  { key: 'lifespan', label: 'Lifespan' },
  { key: 'warrantyStart', label: 'Warranty start' },
  { key: 'warrantyEnd', label: 'Warranty end' },
  { key: 'purchaseDate', label: 'Purchase date' },
];

@Injectable()
export class AssetsService {
  constructor(
    private prisma: PrismaService,
    private activity: AssetActivityService,
  ) {}

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
              // The list's Return action and its "until exit" / overdue markers
              // read these off the row rather than fetching the allocation again.
              retention: held.retention,
              expectedReturnDate: held.expectedReturnDate,
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

  async create(clientId: string, dto: CreateAssetDto, actorId: string) {
    const assetId = dto.assetId.trim();
    await this.assertCodeFree(clientId, assetId);
    const asset = await this.prisma.asset.create({
      data: {
        ...this.writable(dto),
        clientId,
        assetId,
        assetName: dto.assetName.trim(),
        createdBy: actorId,
        updatedBy: actorId,
      },
    });

    await this.activity.log({
      clientId,
      assetId: asset.id,
      type: 'ASSET_CREATED',
      summary: `Added ${asset.assetId} — ${asset.assetName} to the register`,
      actorUserId: actorId,
      actorName: await this.activity.actorName(actorId),
    });

    return asset;
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

    const actorName = await this.activity.actorName(actorId);

    // The condition is the one field with a life of its own — an admin clearing
    // DAMAGED back to OK is "repaired", not a field edit — so it gets its own
    // entry rather than being buried in a list of changed fields.
    if (updated.condition !== asset.condition) {
      await this.activity.log({
        clientId,
        assetId: id,
        type: 'CONDITION_CHANGED',
        summary: `Condition ${assetConditionLabel(asset.condition)} → ${assetConditionLabel(updated.condition)}`,
        meta: { from: asset.condition, to: updated.condition },
        actorUserId: actorId,
        actorName,
      });
    }

    const changed = TRACKED_FIELDS.filter(
      ({ key }) => dto[key] !== undefined && !same(asset[key as keyof typeof asset], updated[key as keyof typeof updated]),
    );
    if (changed.length) {
      await this.activity.log({
        clientId,
        assetId: id,
        type: 'ASSET_UPDATED',
        summary: `Updated ${changed.map((c) => c.label.toLowerCase()).join(', ')}`,
        meta: Object.fromEntries(
          changed.map(({ key }) => [
            key,
            { from: asset[key as keyof typeof asset], to: updated[key as keyof typeof updated] },
          ]),
        ),
        actorUserId: actorId,
        actorName,
      });
    }

    return updated;
  }

  async remove(id: string, clientId: string) {
    await this.findOne(id, clientId);
    // Allocations and the activity trail cascade with the asset; a TicketApproval
    // that requested it keeps its denormalised code/name and simply loses the
    // link (SetNull).
    await this.prisma.asset.delete({ where: { id } });
    return { id };
  }


  /**
   * The register as a spreadsheet — every column the importer accepts, plus the
   * current holding as read-back context, so an export can be edited and posted
   * straight back.
   */
  async exportSheet(clientId: string) {
    const rows = await this.list(clientId);
    return exportSheet('Assets', ASSET_COLUMNS, rows as unknown as AssetSheetRow[]);
  }

  /** The blank template: the same columns, minus the ones an import cannot set. */
  importTemplate() {
    return importTemplate('Assets', ASSET_COLUMNS, ASSET_IMPORT_NOTES);
  }

  /**
   * Bulk add/update from a spreadsheet, matched on `assetId`.
   *
   * Every row goes through the ordinary `create` / `update`, so the code-uniqueness
   * check and the audit trail apply exactly as they do on the form — an import is
   * a fast way to type, not a second way in. Rows run **serially**: two rows
   * claiming the same new code have to see each other, which a `Promise.all`
   * would not.
   */
  async importSheet(clientId: string, actorId: string, file?: Express.Multer.File): Promise<ImportResult> {
    const records = readSheet(file);
    const result: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] };

    const column = (header: string) => ASSET_COLUMNS.find((c) => c.header === header)!;
    const [ID, NAME, CONDITION] = [column('Asset ID'), column('Asset name'), column('Condition')];
    const DATES = ['Purchase date', 'Warranty start', 'Warranty end'].map(column);
    const TEXTS: [SheetColumn<AssetSheetRow>, keyof UpdateAssetDto][] = [
      [column('Type'), 'assetType'],
      [column('Category'), 'assetCategory'],
      [column('Serial number'), 'serialNumber'],
      [column('Manufacturer'), 'manufacturer'],
      [column('Model'), 'model'],
      [column('Barcode'), 'barcode'],
      [column('Description'), 'description'],
      [column('PO number'), 'poNumber'],
      [column('Supplier'), 'supplierName'],
      [column('Invoice number'), 'invoiceNumber'],
      [column('Lifespan'), 'lifespan'],
    ];
    const DATE_KEYS: (keyof UpdateAssetDto)[] = ['purchaseDate', 'warrantyStart', 'warrantyEnd'];

    for (const [i, record] of records.entries()) {
      const line = i + 2; // the header is row 1, so a sheet row is its index + 2
      try {
        const read = rowReader(record);
        const assetId = asText(read(ID));
        const assetName = asText(read(NAME));
        // A trailing blank row is the normal shape of a hand-edited sheet, not an error.
        if (!assetId && !assetName && !Object.values(record).some((v) => asText(v))) continue;
        if (!assetId) throw new BadRequestException('Asset ID is required');

        // A blank cell on an update means "leave it alone", so only the columns
        // the sheet actually carries are sent — the DTO's undefined-skips-the-field
        // rule does the rest.
        const dto: UpdateAssetDto = {};
        for (const [col, key] of TEXTS) {
          const v = asText(read(col));
          if (v) (dto as Record<string, unknown>)[key] = v;
        }
        for (const [idx, col] of DATES.entries()) {
          const v = asDate(read(col), col.header);
          if (v) (dto as Record<string, unknown>)[DATE_KEYS[idx]] = v;
        }
        const condition = asEnum(read(CONDITION), ASSET_CONDITIONS, ASSET_CONDITION_LABELS, 'Condition');
        if (condition) dto.condition = condition;

        const existing = await this.prisma.asset.findFirst({
          where: { clientId, assetId },
          select: { id: true },
        });
        if (existing) {
          if (assetName) dto.assetName = assetName;
          await this.update(existing.id, clientId, dto, actorId);
          result.updated += 1;
        } else {
          if (!assetName) throw new BadRequestException('Asset name is required to add a new asset');
          await this.create(clientId, { ...dto, assetId, assetName } as CreateAssetDto, actorId);
          result.created += 1;
        }
      } catch (e) {
        result.skipped += 1;
        result.errors.push({ row: line, message: errorText(e) });
      }
    }

    return result;
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
      // Never null: the column is non-nullable, so an emptied box means "OK".
      condition: dto.condition === undefined ? undefined : dto.condition || 'OK',
      warrantyStart: dto.warrantyStart === undefined ? undefined : day(dto.warrantyStart),
      warrantyEnd: dto.warrantyEnd === undefined ? undefined : day(dto.warrantyEnd),
      purchaseDate: dto.purchaseDate === undefined ? undefined : day(dto.purchaseDate),
    };
  }
}
