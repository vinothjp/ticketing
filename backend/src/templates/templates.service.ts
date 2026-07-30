import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma, TemplateField } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateTemplateFieldsDto } from './dto/update-template-fields.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import {
  CreateTemplateDto,
  TemplateFieldInputDto,
} from './dto/create-template.dto';
import {
  FIELD_CATALOG_MAP,
  CUSTOM_FIELD_DATA_TYPES,
  OPTION_BACKED_DATA_TYPES,
  FieldDataType,
  FieldGroup,
} from '../tickets/field-catalog';

/** Shape returned to the designer and the Create Ticket form — catalog + custom fields resolved. */
export interface MergedTemplateField {
  id: string;
  fieldKey: string;
  isCustom: boolean;
  label: string;
  group: FieldGroup;
  dataType: FieldDataType;
  picklistKey: string | null;
  options: { value: string; label: string }[];
  placeholder: string | null;
  visibility: 'VISIBLE' | 'HIDDEN';
  requirement: 'MANDATORY' | 'OPTIONAL';
  readOnly: boolean;
  sortOrder: number;
  systemManaged: boolean;
  storage: 'column' | 'json';
  helperText: string;
  helperTextOverride: string | null;
  defaultValueOverride: string | null;
}

function slugify(input: string) {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 24) || 'field'
  );
}

@Injectable()
export class TemplatesService {
  constructor(private prisma: PrismaService) {}

  private async findTemplateOrThrow(templateId: string, clientId: string) {
    const template = await this.prisma.template.findFirst({
      where: { id: templateId, clientId },
    });
    if (!template) throw new NotFoundException('Template not found');
    return template;
  }

  private mergeField(f: TemplateField): MergedTemplateField {
    const base = {
      id: f.id,
      fieldKey: f.fieldKey,
      isCustom: f.isCustom,
      visibility: f.visibility,
      requirement: f.requirement,
      readOnly: f.readOnly,
      sortOrder: f.sortOrder,
      helperTextOverride: f.helperTextOverride ?? null,
      defaultValueOverride: f.defaultValueOverride ?? null,
    };

    if (f.isCustom) {
      return {
        ...base,
        label: f.label ?? f.fieldKey,
        group: (f.group as FieldGroup) ?? 'ticket_detail',
        dataType: (f.dataType as FieldDataType) ?? 'TEXT',
        picklistKey: null,
        options: (f.options as { value: string; label: string }[]) ?? [],
        placeholder: f.placeholder ?? null,
        systemManaged: false,
        storage: 'json',
        helperText: f.helperTextOverride ?? '',
      };
    }

    const catalog = FIELD_CATALOG_MAP.get(f.fieldKey);
    if (!catalog) {
      // Field key no longer in the catalog (e.g. a retired system field) — degrade gracefully.
      return {
        ...base,
        label: f.label ?? f.fieldKey,
        group: (f.group as FieldGroup) ?? 'ticket_detail',
        dataType: (f.dataType as FieldDataType) ?? 'TEXT',
        picklistKey: null,
        options: (f.options as { value: string; label: string }[]) ?? [],
        placeholder: null,
        systemManaged: false,
        storage: 'json',
        helperText: f.helperTextOverride ?? '',
      };
    }

    return {
      ...base,
      label: catalog.label,
      group: catalog.group,
      dataType: catalog.dataType,
      picklistKey: catalog.picklistKey ?? null,
      options: (f.options as { value: string; label: string }[]) ?? [],
      placeholder: null,
      systemManaged: !!catalog.systemManaged,
      storage: catalog.storage ?? 'column',
      helperText: f.helperTextOverride ?? catalog.defaultHelperText,
    };
  }

  /** Validates a field input and builds the row data for persistence. */
  private buildFieldData(
    field: TemplateFieldInputDto,
    index: number,
    usedKeys: Set<string>,
    actorId: string,
  ): Prisma.TemplateFieldCreateWithoutTemplateInput | null {
    const isCustom = !!field.isCustom;
    let fieldKey = field.fieldKey?.trim();

    if (isCustom) {
      if (!field.label?.trim()) {
        throw new BadRequestException('Custom fields need a label');
      }
      const dataType = field.dataType as FieldDataType | undefined;
      if (!dataType || !CUSTOM_FIELD_DATA_TYPES.includes(dataType)) {
        throw new BadRequestException(
          `Custom field "${field.label}" has an invalid type`,
        );
      }
      if (
        OPTION_BACKED_DATA_TYPES.includes(dataType) &&
        !(field.options && field.options.length)
      ) {
        throw new BadRequestException(
          `Custom field "${field.label}" needs at least one option`,
        );
      }
      if (!fieldKey || !fieldKey.startsWith('cf_') || usedKeys.has(fieldKey)) {
        do {
          fieldKey = `cf_${slugify(field.label)}_${randomUUID().slice(0, 6)}`;
        } while (usedKeys.has(fieldKey));
      }
    } else {
      // Non-custom field that's no longer in the catalog (e.g. a retired system
      // field left over on an old template) — drop it silently rather than block the save.
      if (!fieldKey || !FIELD_CATALOG_MAP.has(fieldKey)) {
        return null;
      }
      if (usedKeys.has(fieldKey)) {
        throw new BadRequestException(`Duplicate field: ${fieldKey}`);
      }
    }

    usedKeys.add(fieldKey);

    return {
      fieldKey,
      isCustom,
      label: isCustom ? field.label!.trim() : null,
      dataType: isCustom ? (field.dataType ?? null) : null,
      group: isCustom ? (field.group ?? 'ticket_detail') : null,
      placeholder: isCustom ? (field.placeholder ?? null) : null,
      // Persist options for custom option fields AND for Attachment fields
      // (system or custom), where options carry the allowed file types.
      options: field.options?.length
        ? (field.options as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull,
      visibility: field.visibility ?? 'VISIBLE',
      requirement: field.requirement ?? 'OPTIONAL',
      readOnly: field.readOnly ?? false,
      sortOrder: field.sortOrder ?? index,
      helperTextOverride: field.helperTextOverride || null,
      defaultValueOverride: field.defaultValueOverride || null,
      createdBy: actorId,
      updatedBy: actorId,
    };
  }

  // ---- Queries -------------------------------------------------------------

  async findAll(clientId: string) {
    const templates = await this.prisma.template.findMany({
      where: { clientId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: { _count: { select: { fields: true, tickets: true } } },
    });
    return templates.map((t) => ({
      id: t.id,
      name: t.name,
      category: t.category,
      description: t.description,
      icon: t.icon,
      color: t.color,
      isActive: t.isActive,
      sortOrder: t.sortOrder,
      fieldCount: t._count.fields,
      ticketCount: t._count.tickets,
    }));
  }

  async getById(id: string, clientId: string) {
    const template = await this.prisma.template.findFirst({
      where: { id, clientId },
      include: { fields: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!template) throw new NotFoundException('Template not found');
    return { ...template, fields: template.fields.map((f) => this.mergeField(f)) };
  }

  // ---- Mutations -----------------------------------------------------------

  async create(dto: CreateTemplateDto, clientId: string, actorId: string) {
    const name = dto.name.trim();
    const existing = await this.prisma.template.findFirst({
      where: { clientId, name },
    });
    if (existing) throw new ConflictException('A template with this name already exists');

    const usedKeys = new Set<string>();
    const fields = (dto.fields ?? [])
      .map((f, i) => this.buildFieldData(f, i, usedKeys, actorId))
      .filter((f): f is Prisma.TemplateFieldCreateWithoutTemplateInput => f !== null);

    const last = await this.prisma.template.findFirst({
      where: { clientId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });

    return this.prisma.template.create({
      data: {
        clientId,
        name,
        category: dto.category,
        description: dto.description,
        descriptionGuidance: dto.descriptionGuidance,
        icon: dto.icon,
        color: dto.color,
        defaultPriority: dto.defaultPriority,
        isActive: dto.isActive ?? true,
        sortOrder: (last?.sortOrder ?? -1) + 1,
        createdBy: actorId,
        updatedBy: actorId,
        fields: { create: fields },
      },
      include: { fields: true },
    });
  }

  async update(
    templateId: string,
    clientId: string,
    dto: UpdateTemplateDto,
    actorId: string,
  ) {
    await this.findTemplateOrThrow(templateId, clientId);

    if (dto.name) {
      const clash = await this.prisma.template.findFirst({
        where: { clientId, name: dto.name.trim(), id: { not: templateId } },
      });
      if (clash) throw new ConflictException('A template with this name already exists');
    }

    return this.prisma.template.update({
      where: { id: templateId },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.descriptionGuidance !== undefined && {
          descriptionGuidance: dto.descriptionGuidance,
        }),
        ...(dto.icon !== undefined && { icon: dto.icon }),
        ...(dto.color !== undefined && { color: dto.color }),
        ...(dto.defaultPriority !== undefined && {
          defaultPriority: dto.defaultPriority,
        }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        updatedBy: actorId,
      },
    });
  }

  /** Replaces the template's entire field set with the supplied list. */
  async updateFields(
    templateId: string,
    clientId: string,
    dto: UpdateTemplateFieldsDto,
    actorId: string,
  ) {
    await this.findTemplateOrThrow(templateId, clientId);

    const usedKeys = new Set<string>();
    const fields = dto.fields
      .map((f, i) => this.buildFieldData(f, i, usedKeys, actorId))
      .filter((f): f is Prisma.TemplateFieldCreateWithoutTemplateInput => f !== null);

    await this.prisma.$transaction([
      this.prisma.templateField.deleteMany({ where: { templateId } }),
      this.prisma.templateField.createMany({
        data: fields.map((f) => ({ ...f, templateId })),
      }),
    ]);

    return this.getById(templateId, clientId);
  }

  async remove(templateId: string, clientId: string) {
    await this.findTemplateOrThrow(templateId, clientId);
    const ticketCount = await this.prisma.ticket.count({ where: { templateId } });
    if (ticketCount > 0) {
      throw new ConflictException(
        'This template has tickets and cannot be deleted. Deactivate it instead.',
      );
    }
    await this.prisma.template.delete({ where: { id: templateId } });
    return { message: 'Template deleted' };
  }
}
