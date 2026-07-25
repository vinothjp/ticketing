import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateTemplateFieldsDto } from './dto/update-template-fields.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import {
  FIELD_CATALOG,
  FIELD_CATALOG_MAP,
  DEFAULT_VISIBLE_MANDATORY_FIELDS,
} from '../tickets/field-catalog';

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

  /** Ensures a TemplateField row exists for every catalog key, seeding sane defaults for new ones. */
  private async ensureFieldRows(templateId: string) {
    const existing = await this.prisma.templateField.findMany({
      where: { templateId },
    });
    const existingKeys = new Set(existing.map((f) => f.fieldKey));
    const missing = FIELD_CATALOG.filter((f) => !existingKeys.has(f.key));
    if (missing.length === 0) return;

    await this.prisma.$transaction(
      missing.map((f, i) =>
        this.prisma.templateField.create({
          data: {
            templateId,
            fieldKey: f.key,
            visibility: DEFAULT_VISIBLE_MANDATORY_FIELDS.includes(f.key)
              ? 'VISIBLE'
              : 'HIDDEN',
            requirement: DEFAULT_VISIBLE_MANDATORY_FIELDS.includes(f.key)
              ? 'MANDATORY'
              : 'OPTIONAL',
            sortOrder: existing.length + i,
          },
        }),
      ),
    );
  }

  async getByRequestType(requestTypeId: string, clientId: string) {
    const template = await this.prisma.template.findFirst({
      where: { requestTypeId, clientId },
    });
    if (!template)
      throw new NotFoundException('Template not found for this request type');

    await this.ensureFieldRows(template.id);

    const fields = await this.prisma.templateField.findMany({
      where: { templateId: template.id },
      orderBy: { sortOrder: 'asc' },
    });

    return {
      ...template,
      fields: fields.map((f) => {
        const catalog = FIELD_CATALOG_MAP.get(f.fieldKey)!;
        return {
          ...f,
          label: catalog.label,
          group: catalog.group,
          dataType: catalog.dataType,
          picklistKey: catalog.picklistKey ?? null,
          systemManaged: !!catalog.systemManaged,
          helperText: f.helperTextOverride ?? catalog.defaultHelperText,
        };
      }),
    };
  }

  async updateFields(
    templateId: string,
    clientId: string,
    dto: UpdateTemplateFieldsDto,
    actorId: string,
  ) {
    await this.findTemplateOrThrow(templateId, clientId);

    for (const f of dto.fields) {
      if (!FIELD_CATALOG_MAP.has(f.fieldKey)) {
        throw new BadRequestException(`Unknown field key: ${f.fieldKey}`);
      }
    }

    await this.prisma.$transaction(
      dto.fields.map((f) =>
        this.prisma.templateField.upsert({
          where: { templateId_fieldKey: { templateId, fieldKey: f.fieldKey } },
          update: {
            visibility: f.visibility,
            requirement: f.requirement,
            readOnly: f.readOnly,
            sortOrder: f.sortOrder,
            helperTextOverride: f.helperTextOverride,
            defaultValueOverride: f.defaultValueOverride,
            updatedBy: actorId,
          },
          create: {
            templateId,
            fieldKey: f.fieldKey,
            visibility: f.visibility,
            requirement: f.requirement,
            readOnly: f.readOnly,
            sortOrder: f.sortOrder,
            helperTextOverride: f.helperTextOverride,
            defaultValueOverride: f.defaultValueOverride,
            createdBy: actorId,
            updatedBy: actorId,
          },
        }),
      ),
    );

    return this.getByRequestType(
      (
        await this.prisma.template.findUniqueOrThrow({
          where: { id: templateId },
        })
      ).requestTypeId,
      clientId,
    );
  }

  async update(
    templateId: string,
    clientId: string,
    dto: UpdateTemplateDto,
    actorId: string,
  ) {
    await this.findTemplateOrThrow(templateId, clientId);
    return this.prisma.template.update({
      where: { id: templateId },
      data: { ...dto, updatedBy: actorId },
    });
  }
}
