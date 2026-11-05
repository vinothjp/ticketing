import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProjectTemplateDto, UpdateProjectTemplateDto } from './dto/project-template.dto';

/**
 * A template's milestones become a project's milestones, and a project refuses two
 * with the same name (ProjectsService.assertMilestoneNameFree) — so a template
 * must not carry two either, ignoring case and surrounding spaces, or every
 * project made from it starts with a duplicate.
 */
function assertUniqueMilestones(blueprint: Record<string, unknown> | undefined) {
  const milestones = Array.isArray(blueprint?.milestones) ? (blueprint.milestones as { name?: unknown }[]) : [];
  const seen = new Map<string, string>();
  for (const m of milestones) {
    const name = typeof m?.name === 'string' ? m.name.trim() : '';
    if (!name) continue;
    const first = seen.get(name.toLowerCase());
    if (first) throw new ConflictException(`This template has two milestones named "${first}" — each milestone needs its own name`);
    seen.set(name.toLowerCase(), name);
  }
}

@Injectable()
export class ProjectTemplatesService {
  constructor(private prisma: PrismaService) {}

  list(clientId: string) {
    return this.prisma.projectTemplate.findMany({
      where: { clientId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async getById(id: string, clientId: string) {
    const tpl = await this.prisma.projectTemplate.findFirst({ where: { id, clientId } });
    if (!tpl) throw new NotFoundException('Project template not found');
    return tpl;
  }

  async create(dto: CreateProjectTemplateDto, clientId: string, actorId: string) {
    const dup = await this.prisma.projectTemplate.findFirst({ where: { clientId, name: dto.name.trim() } });
    if (dup) throw new ConflictException('A project template with this name already exists');
    assertUniqueMilestones(dto.blueprint);
    return this.prisma.projectTemplate.create({
      data: {
        clientId,
        name: dto.name.trim(),
        description: dto.description,
        category: dto.category,
        icon: dto.icon,
        color: dto.color,
        blueprint: (dto.blueprint ?? { milestones: [] }) as Prisma.InputJsonValue,
        createdBy: actorId,
        updatedBy: actorId,
      },
    });
  }

  async update(id: string, clientId: string, dto: UpdateProjectTemplateDto, actorId: string) {
    await this.getById(id, clientId);
    if (dto.name) {
      const dup = await this.prisma.projectTemplate.findFirst({
        where: { clientId, name: dto.name.trim(), id: { not: id } },
      });
      if (dup) throw new ConflictException('A project template with this name already exists');
    }
    assertUniqueMilestones(dto.blueprint);
    return this.prisma.projectTemplate.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        description: dto.description,
        category: dto.category,
        icon: dto.icon,
        color: dto.color,
        isActive: dto.isActive,
        ...(dto.blueprint !== undefined && { blueprint: dto.blueprint as Prisma.InputJsonValue }),
        updatedBy: actorId,
      },
    });
  }

  async remove(id: string, clientId: string) {
    await this.getById(id, clientId);
    await this.prisma.projectTemplate.delete({ where: { id } });
    return { message: 'Project template deleted' };
  }
}
