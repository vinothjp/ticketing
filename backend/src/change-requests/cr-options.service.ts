import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCrOptionDto, UpdateCrOptionDto } from './dto/change-request.dto';

type Actor = { id: string };

// Seeded-by-default lists for the CR module (from the Change Request sheet).
// People / customer / project / module lists start empty for admins to fill.
const DEFAULT_OPTIONS: Record<string, string[]> = {
  // Change Management (ITIL) lists — General section.
  change_type: ['Emergency', 'Major', 'Minor', 'Standard'],
  change_group: ['Infrastructure', 'Software'],
  impact: ['Affects Business', 'Affects Department', 'Affects Group', 'Affects User', 'No Impact'],
  risk: ['Low', 'Medium', 'High'],
  priority: ['Low', 'Medium', 'High', 'Urgent'],
  category: ['Application', 'Email', 'Downtime', 'Network', 'OS'],
  status: [
    'Requested', 'Accepted', 'Rejected', 'Request for additional info', 'Submitted for Authorisation',
  ],
  // Existing dev-lifecycle lists (kept — the phase tabs still use them).
  type: ['New Feature', 'Enhancement', 'Bug Fix', 'Config Change'],
  complexity: ['Low', 'Medium', 'High'],
  dev_status: ['Not Started', 'In Progress', 'Completed'],
  test_status: ['Not Started', 'In Progress', 'Pass', 'Fail'],
  doc_title: ['Emails', 'Minutes', 'Additional docs'],
  yes_no: ['Yes', 'No'],
  approval: ['Approved', 'Pending', 'Rejected'],
};

// Dependent lists seeded with a parentValue (subcategory shows under its category).
const DEFAULT_DEPENDENT_OPTIONS: Record<string, { value: string; parentValue: string }[]> = {
  subcategory: [
    { value: 'SAP', parentValue: 'Application' },
    { value: 'B1', parentValue: 'Application' },
  ],
};

// The registry of CR lists now lives in option-lists/default-lists.ts, managed
// on the unified Option List screen. (`customer` is deliberately not among them:
// a CR points at a real CustomerCompany and `ChangeRequest.customer` is
// denormalised from it, so no dropdown ever reads that list.)

@Injectable()
export class CrOptionsService {
  constructor(private prisma: PrismaService) {}

  // Idempotent: seed default options once per client (only when none exist yet,
  // so admin customisations/deletions are never overwritten).
  async ensureDefaults(clientId: string) {
    const count = await this.prisma.changeRequestOption.count({ where: { clientId } });
    if (count > 0) return;
    const data = [
      ...Object.entries(DEFAULT_OPTIONS).flatMap(([listKey, values]) =>
        values.map((value, sortOrder) => ({ clientId, listKey, value, label: value, sortOrder, parentValue: null as string | null })),
      ),
      ...Object.entries(DEFAULT_DEPENDENT_OPTIONS).flatMap(([listKey, opts]) =>
        opts.map((o, sortOrder) => ({ clientId, listKey, value: o.value, label: o.value, sortOrder, parentValue: o.parentValue })),
      ),
    ];
    await this.prisma.changeRequestOption.createMany({ data, skipDuplicates: true });
  }

  async findAll(clientId: string, listKey?: string) {
    await this.ensureDefaults(clientId);
    return this.prisma.changeRequestOption.findMany({
      where: { clientId, ...(listKey ? { listKey } : {}) },
      orderBy: [{ listKey: 'asc' }, { sortOrder: 'asc' }],
    });
  }

  private async getOwned(id: string, clientId: string) {
    const opt = await this.prisma.changeRequestOption.findFirst({ where: { id, clientId } });
    if (!opt) throw new NotFoundException('Change request option not found');
    return opt;
  }

  async create(dto: CreateCrOptionDto, clientId: string, actor: Actor) {
    const existing = await this.prisma.changeRequestOption.findFirst({
      where: { clientId, listKey: dto.listKey, value: dto.value },
    });
    if (existing) throw new ConflictException('An option with this value already exists in this list');
    return this.prisma.changeRequestOption.create({
      data: {
        clientId,
        listKey: dto.listKey,
        value: dto.value,
        label: dto.label,
        parentValue: dto.parentValue ?? null,
        isActive: dto.isActive ?? true,
        sortOrder: dto.sortOrder ?? 0,
        createdBy: actor.id,
        updatedBy: actor.id,
      },
    });
  }

  async update(id: string, dto: UpdateCrOptionDto, clientId: string, actor: Actor) {
    const opt = await this.getOwned(id, clientId);
    // If the value changes, keep it unique within the list.
    if (dto.value && dto.value !== opt.value) {
      const clash = await this.prisma.changeRequestOption.findFirst({
        where: { clientId, listKey: opt.listKey, value: dto.value },
      });
      if (clash) throw new ConflictException('An option with this value already exists in this list');
    }
    return this.prisma.changeRequestOption.update({
      where: { id },
      data: { ...dto, updatedBy: actor.id },
    });
  }

  async remove(id: string, clientId: string) {
    await this.getOwned(id, clientId);
    await this.prisma.changeRequestOption.delete({ where: { id } });
    return { message: 'Change request option deleted' };
  }
}
