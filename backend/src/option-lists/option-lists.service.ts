import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CrOptionsService } from '../change-requests/cr-options.service';
import {
  DEFAULT_LISTS, MODULE_LABELS, MODULE_SOURCE, SOURCE_LABELS, SOURCE_MODULE,
  type OptionSource,
} from './default-lists';
import {
  CreateOptionListDto,
  UpdateOptionListDto,
  CreateOptionValueDto,
  UpdateOptionValueDto,
} from './dto/option-list.dto';

type Actor = { id: string };

// One value of a list, in the screen's vocabulary. The backing tables call
// these `value` / `label` / `sortOrder`.
export interface OptionValueView {
  id: string;
  code: string;
  description: string;
  parentValue: string | null;
  isActive: boolean;
  seq: number;
}

/**
 * The one service behind the unified Option List screen.
 *
 * It owns the `OptionList` registry and proxies value reads/writes to whichever
 * table actually stores them — `PicklistOption` for ticketing/KB lists,
 * `ChangeRequestOption` for Change Management ones. Nothing else in the app has
 * to change: every existing dropdown keeps reading its own endpoint.
 */
@Injectable()
export class OptionListsService {
  constructor(
    private prisma: PrismaService,
    private crOptions: CrOptionsService,
  ) {}

  // ---------------------------------------------------------------- registry

  // Idempotent: adds any system list this tenant is missing, and never
  // overwrites an admin's rename or their edits to a list's values.
  async ensureDefaults(clientId: string) {
    // The CR module seeds its own values lazily; do it here too so a freshly
    // opened screen reports the real value counts.
    await this.crOptions.ensureDefaults(clientId);

    const existing = await this.prisma.optionList.findMany({
      where: { clientId },
      select: { code: true, module: true, source: true },
    });

    // A system list seeded before the `module` column existed, or one whose
    // module has since moved (DATE_FORMAT went from Ticketing to Organization),
    // is corrected here. Only `module` is touched: it is derived from
    // DEFAULT_LISTS, never typed by an admin, so there is nothing to overwrite.
    const byCode = new Map(existing.map((l) => [l.code, l]));
    for (const l of DEFAULT_LISTS) {
      const row = byCode.get(l.code);
      const want = l.module ?? SOURCE_MODULE[l.source];
      if (row && row.module !== want) {
        await this.prisma.optionList.updateMany({
          where: { clientId, code: l.code },
          data: { module: want },
        });
      }
    }

    const have = new Set(existing.map((l) => l.code));
    const missing = DEFAULT_LISTS.filter((l) => !have.has(l.code));
    if (!missing.length) return;

    await this.prisma.optionList.createMany({
      data: missing.map((l) => ({
        clientId,
        code: l.code,
        name: l.name,
        description: l.description ?? null,
        source: l.source,
        module: l.module ?? SOURCE_MODULE[l.source],
        listKey: l.listKey,
        parentListKey: l.parentListKey ?? null,
        isSystem: true,
        sortOrder: DEFAULT_LISTS.indexOf(l),
      })),
      skipDuplicates: true,
    });

    // A list whose values used to be a hard-coded array in the app arrives here
    // empty, which would leave its field with nothing to pick. Seed the array it
    // replaced — only into an empty list, so an admin's edits are never undone.
    // CR lists seed through CrOptionsService, so this only covers PICKLIST ones.
    for (const l of missing.filter((m) => m.source === 'PICKLIST' && m.defaultValues?.length)) {
      const existingValues = await this.prisma.picklistOption.count({
        where: { clientId, listKey: l.listKey },
      });
      if (existingValues) continue;
      await this.prisma.picklistOption.createMany({
        data: l.defaultValues!.map((value, sortOrder) => ({
          clientId,
          listKey: l.listKey,
          value,
          label: value,
          sortOrder,
        })),
        skipDuplicates: true,
      });
    }
  }

  async findAll(clientId: string) {
    await this.ensureDefaults(clientId);
    const lists = await this.prisma.optionList.findMany({
      where: { clientId },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });

    // Two grouped counts beat one query per list.
    const [picklistCounts, crCounts] = await Promise.all([
      this.prisma.picklistOption.groupBy({
        by: ['listKey'],
        where: { clientId },
        _count: { _all: true },
      }),
      this.prisma.changeRequestOption.groupBy({
        by: ['listKey'],
        where: { clientId },
        _count: { _all: true },
      }),
    ]);
    const counts: Record<string, number> = {};
    for (const row of picklistCounts)
      counts['PICKLIST:' + row.listKey] = row._count._all;
    for (const row of crCounts)
      counts['CHANGE_REQUEST:' + row.listKey] = row._count._all;

    return lists.map((l) => {
      // A row with no module yet falls back to the one its store implies, so the
      // Module column is never blank while a backfill is still pending.
      const module = l.module ?? SOURCE_MODULE[l.source as OptionSource] ?? l.source;
      return {
        ...l,
        module,
        sourceLabel:
          MODULE_LABELS[module] ?? SOURCE_LABELS[l.source as OptionSource] ?? l.source,
        valueCount: counts[l.source + ':' + l.listKey] ?? 0,
      };
    });
  }

  private async getOwned(id: string, clientId: string) {
    const list = await this.prisma.optionList.findFirst({
      where: { id, clientId },
    });
    if (!list) throw new NotFoundException('Option list not found');
    return list;
  }

  async create(dto: CreateOptionListDto, clientId: string, actor: Actor) {
    await this.ensureDefaults(clientId);
    const code = dto.code.trim().toUpperCase();
    const clash = await this.prisma.optionList.findFirst({
      where: { clientId, code },
    });
    if (clash)
      throw new ConflictException('An option list with this code already exists');

    // A custom list stores its values under its own code as the list key, so it
    // is readable through the existing picklist endpoint the moment it exists.
    // The screen picks a *module*; the module names the store. `source` is still
    // accepted for a caller that names the store directly.
    const module = dto.module ?? (dto.source ? SOURCE_MODULE[dto.source as OptionSource] : 'TICKETING');
    const source = MODULE_SOURCE[module] ?? (dto.source as OptionSource) ?? 'PICKLIST';
    const listKey = code;
    const keyClash = await this.prisma.optionList.findFirst({
      where: { clientId, source, listKey },
    });
    if (keyClash)
      throw new ConflictException('An option list already uses this key');

    const last = await this.prisma.optionList.findFirst({
      where: { clientId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });

    return this.prisma.optionList.create({
      data: {
        clientId,
        code,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        source,
        module,
        listKey,
        parentListKey: dto.parentListKey || null,
        allowCustom: dto.allowCustom ?? false,
        isActive: dto.isActive ?? true,
        isSystem: false,
        sortOrder: dto.sortOrder ?? (last ? last.sortOrder + 1 : 0),
        createdBy: actor.id,
        updatedBy: actor.id,
      },
    });
  }

  async update(
    id: string,
    dto: UpdateOptionListDto,
    clientId: string,
    actor: Actor,
  ) {
    const list = await this.getOwned(id, clientId);
    const nextCode = dto.code ? dto.code.trim().toUpperCase() : undefined;
    const rekeyed = !!nextCode && nextCode !== list.code;

    if (rekeyed && list.isSystem)
      throw new BadRequestException(
        'A built-in list cannot be re-coded — application code reads it by key. Rename it instead.',
      );
    if (rekeyed) {
      const clash = await this.prisma.optionList.findFirst({
        where: { clientId, code: nextCode },
      });
      if (clash)
        throw new ConflictException(
          'An option list with this code already exists',
        );
    }

    const data = {
      ...(nextCode ? { code: nextCode } : {}),
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      ...(dto.description !== undefined
        ? { description: dto.description.trim() || null }
        : {}),
      ...(dto.parentListKey !== undefined
        ? { parentListKey: dto.parentListKey || null }
        : {}),
      ...(dto.allowCustom !== undefined ? { allowCustom: dto.allowCustom } : {}),
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      updatedBy: actor.id,
      // A custom list keys its values off its code, so re-coding moves them.
      ...(rekeyed ? { listKey: nextCode } : {}),
    };

    if (!rekeyed || !nextCode)
      return this.prisma.optionList.update({ where: { id }, data });

    // Move the values with the list, or they are orphaned under the old key.
    const [updated] = await this.prisma.$transaction([
      this.prisma.optionList.update({ where: { id }, data }),
      list.source === 'CHANGE_REQUEST'
        ? this.prisma.changeRequestOption.updateMany({
            where: { clientId, listKey: list.listKey },
            data: { listKey: nextCode },
          })
        : this.prisma.picklistOption.updateMany({
            where: { clientId, listKey: list.listKey },
            data: { listKey: nextCode },
          }),
    ]);
    return updated;
  }

  async remove(id: string, clientId: string) {
    const list = await this.getOwned(id, clientId);
    if (list.isSystem)
      throw new BadRequestException(
        'A built-in list cannot be deleted — the app reads it by key. Deactivate it or clear its values instead.',
      );
    await this.prisma.$transaction([
      list.source === 'CHANGE_REQUEST'
        ? this.prisma.changeRequestOption.deleteMany({
            where: { clientId, listKey: list.listKey },
          })
        : this.prisma.picklistOption.deleteMany({
            where: { clientId, listKey: list.listKey },
          }),
      this.prisma.optionList.delete({ where: { id } }),
    ]);
    return { message: 'Option list deleted' };
  }

  // ------------------------------------------------------------------ values

  private view(row: {
    id: string;
    value: string;
    label: string;
    parentValue: string | null;
    isActive: boolean;
    sortOrder: number;
  }): OptionValueView {
    return {
      id: row.id,
      code: row.value,
      description: row.label,
      parentValue: row.parentValue,
      isActive: row.isActive,
      seq: row.sortOrder,
    };
  }

  async listValues(id: string, clientId: string) {
    const list = await this.getOwned(id, clientId);
    const where = { clientId, listKey: list.listKey };
    const orderBy = [{ sortOrder: 'asc' as const }, { value: 'asc' as const }];
    const rows =
      list.source === 'CHANGE_REQUEST'
        ? await this.prisma.changeRequestOption.findMany({ where, orderBy })
        : await this.prisma.picklistOption.findMany({ where, orderBy });
    return rows.map((r) => this.view(r));
  }

  // The values of this list's parent, for the dependent-list Parent dropdown.
  async listParentValues(id: string, clientId: string) {
    const list = await this.getOwned(id, clientId);
    if (!list.parentListKey) return [];
    const where = { clientId, listKey: list.parentListKey };
    const orderBy = [{ sortOrder: 'asc' as const }];
    const rows =
      list.source === 'CHANGE_REQUEST'
        ? await this.prisma.changeRequestOption.findMany({ where, orderBy })
        : await this.prisma.picklistOption.findMany({ where, orderBy });
    return rows.map((r) => this.view(r));
  }

  private async assertValueFree(
    list: { source: string; listKey: string },
    clientId: string,
    value: string,
    ignoreId?: string,
  ) {
    const where = {
      clientId,
      listKey: list.listKey,
      value,
      ...(ignoreId ? { NOT: { id: ignoreId } } : {}),
    };
    const clash =
      list.source === 'CHANGE_REQUEST'
        ? await this.prisma.changeRequestOption.findFirst({ where })
        : await this.prisma.picklistOption.findFirst({ where });
    if (clash)
      throw new ConflictException(
        'An option with this code already exists in this list',
      );
  }

  async addValue(
    id: string,
    dto: CreateOptionValueDto,
    clientId: string,
    actor: Actor,
  ) {
    const list = await this.getOwned(id, clientId);
    const value = dto.code.trim();
    await this.assertValueFree(list, clientId, value);

    const count =
      list.source === 'CHANGE_REQUEST'
        ? await this.prisma.changeRequestOption.count({
            where: { clientId, listKey: list.listKey },
          })
        : await this.prisma.picklistOption.count({
            where: { clientId, listKey: list.listKey },
          });

    const data = {
      clientId,
      listKey: list.listKey,
      value,
      label: dto.description?.trim() || value,
      parentValue: dto.parentValue?.trim() || null,
      isActive: dto.isActive ?? true,
      sortOrder: dto.seq ?? count,
      createdBy: actor.id,
      updatedBy: actor.id,
    };
    const row =
      list.source === 'CHANGE_REQUEST'
        ? await this.prisma.changeRequestOption.create({ data })
        : await this.prisma.picklistOption.create({ data });
    return this.view(row);
  }

  async updateValue(
    id: string,
    valueId: string,
    dto: UpdateOptionValueDto,
    clientId: string,
    actor: Actor,
  ) {
    const list = await this.getOwned(id, clientId);
    const where = { id: valueId, clientId, listKey: list.listKey };
    const current =
      list.source === 'CHANGE_REQUEST'
        ? await this.prisma.changeRequestOption.findFirst({ where })
        : await this.prisma.picklistOption.findFirst({ where });
    if (!current) throw new NotFoundException('Option not found in this list');

    const value = dto.code?.trim();
    if (value && value !== current.value)
      await this.assertValueFree(list, clientId, value, valueId);

    const data = {
      ...(value ? { value } : {}),
      ...(dto.description !== undefined
        ? { label: dto.description.trim() || value || current.value }
        : {}),
      ...(dto.parentValue !== undefined
        ? { parentValue: dto.parentValue?.trim() || null }
        : {}),
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      ...(dto.seq !== undefined ? { sortOrder: dto.seq } : {}),
      updatedBy: actor.id,
    };
    const row =
      list.source === 'CHANGE_REQUEST'
        ? await this.prisma.changeRequestOption.update({
            where: { id: valueId },
            data,
          })
        : await this.prisma.picklistOption.update({
            where: { id: valueId },
            data,
          });
    return this.view(row);
  }

  async removeValue(id: string, valueId: string, clientId: string) {
    const list = await this.getOwned(id, clientId);
    const where = { id: valueId, clientId, listKey: list.listKey };
    const current =
      list.source === 'CHANGE_REQUEST'
        ? await this.prisma.changeRequestOption.findFirst({ where })
        : await this.prisma.picklistOption.findFirst({ where });
    if (!current) throw new NotFoundException('Option not found in this list');

    if (list.source === 'CHANGE_REQUEST')
      await this.prisma.changeRequestOption.delete({ where: { id: valueId } });
    else await this.prisma.picklistOption.delete({ where: { id: valueId } });
    return { message: 'Option deleted' };
  }
}
