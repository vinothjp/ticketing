import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateResourceCategoryDto, UpdateResourceCategoryDto } from './dto/resource-category.dto';

type Actor = { id: string };

// Adds computed daily figures (Excel: Daily Cost / Daily Billing / Profit).
function withComputed(c: { hourlyCost: unknown; billingRate: unknown; dailyHours: number } & Record<string, unknown>) {
  const hourly = Number(c.hourlyCost);
  const billing = Number(c.billingRate);
  const dailyCost = hourly * c.dailyHours;
  const dailyBilling = billing * c.dailyHours;
  return { ...c, hourlyCost: hourly, billingRate: billing, dailyCost, dailyBilling, profit: dailyBilling - dailyCost };
}

@Injectable()
export class ResourcesService {
  constructor(private prisma: PrismaService) {}

  async list(clientId: string) {
    const rows = await this.prisma.resourceCategory.findMany({ where: { clientId }, orderBy: { name: 'asc' } });
    return rows.map(withComputed);
  }

  async create(dto: CreateResourceCategoryDto, clientId: string, actor: Actor) {
    const row = await this.prisma.resourceCategory.create({
      data: {
        clientId,
        name: dto.name.trim(),
        hourlyCost: dto.hourlyCost ?? 0,
        billingRate: dto.billingRate ?? 0,
        dailyHours: dto.dailyHours ?? 8,
        isActive: dto.isActive ?? true,
        createdBy: actor.id,
        updatedBy: actor.id,
      },
    });
    return withComputed(row);
  }

  async update(id: string, dto: UpdateResourceCategoryDto, clientId: string, actor: Actor) {
    await this.getOwned(id, clientId);
    const row = await this.prisma.resourceCategory.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.hourlyCost !== undefined ? { hourlyCost: dto.hourlyCost } : {}),
        ...(dto.billingRate !== undefined ? { billingRate: dto.billingRate } : {}),
        ...(dto.dailyHours !== undefined ? { dailyHours: dto.dailyHours } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        updatedBy: actor.id,
      },
    });
    return withComputed(row);
  }

  async remove(id: string, clientId: string) {
    await this.getOwned(id, clientId);
    await this.prisma.resourceCategory.delete({ where: { id } });
    return { message: 'Resource category deleted' };
  }

  private async getOwned(id: string, clientId: string) {
    const row = await this.prisma.resourceCategory.findFirst({ where: { id, clientId } });
    if (!row) throw new NotFoundException('Resource category not found');
    return row;
  }
}
