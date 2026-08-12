import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateProductDto, UpdateProductDto, CreateModuleDto, UpdateModuleDto, SetConsultantDto,
} from './dto/product.dto';

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  list(clientId: string) {
    return this.prisma.product.findMany({
      where: { clientId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        modules: {
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          include: {
            consultants: { include: { user: { select: { id: true, username: true } } } },
          },
        },
      },
    });
  }

  private async ownedProduct(id: string, clientId: string) {
    const p = await this.prisma.product.findFirst({ where: { id, clientId } });
    if (!p) throw new NotFoundException('Product not found');
    return p;
  }
  private async ownedModule(moduleId: string, clientId: string) {
    const m = await this.prisma.productModule.findFirst({ where: { id: moduleId, product: { clientId } } });
    if (!m) throw new NotFoundException('Module not found');
    return m;
  }

  async createProduct(dto: CreateProductDto, clientId: string) {
    const dup = await this.prisma.product.findFirst({ where: { clientId, name: dto.name.trim() } });
    if (dup) throw new ConflictException('A product with this name already exists');
    const count = await this.prisma.product.count({ where: { clientId } });
    return this.prisma.product.create({
      data: { clientId, name: dto.name.trim(), code: dto.code.trim(), autoAssign: dto.autoAssign ?? true, sortOrder: count },
    });
  }

  async updateProduct(id: string, dto: UpdateProductDto, clientId: string) {
    await this.ownedProduct(id, clientId);
    return this.prisma.product.update({
      where: { id },
      data: { name: dto.name?.trim(), code: dto.code?.trim(), autoAssign: dto.autoAssign, isActive: dto.isActive },
    });
  }

  async removeProduct(id: string, clientId: string) {
    await this.ownedProduct(id, clientId);
    await this.prisma.product.delete({ where: { id } });
    return { message: 'Product deleted' };
  }

  async addModule(productId: string, dto: CreateModuleDto, clientId: string) {
    await this.ownedProduct(productId, clientId);
    const count = await this.prisma.productModule.count({ where: { productId } });
    return this.prisma.productModule.create({ data: { productId, name: dto.name.trim(), sortOrder: count } });
  }

  async updateModule(moduleId: string, dto: UpdateModuleDto, clientId: string) {
    await this.ownedModule(moduleId, clientId);
    return this.prisma.productModule.update({ where: { id: moduleId }, data: { name: dto.name.trim() } });
  }

  async removeModule(moduleId: string, clientId: string) {
    await this.ownedModule(moduleId, clientId);
    await this.prisma.productModule.delete({ where: { id: moduleId } });
    return { message: 'Module deleted' };
  }

  // Upsert or clear a single (track, rank) consultant slot on a module.
  async setConsultant(moduleId: string, dto: SetConsultantDto, clientId: string) {
    const mod = await this.ownedModule(moduleId, clientId);
    if (!dto.userId) {
      await this.prisma.moduleConsultant.deleteMany({ where: { moduleId, track: dto.track, rank: dto.rank } });
      return { message: 'Consultant cleared' };
    }
    const staff = await this.prisma.user.findFirst({ where: { id: dto.userId, clientId } });
    if (!staff) throw new NotFoundException('User not found');
    // A consultant is a specialist for exactly one slot — one product, one module,
    // one track (technical/functional), one rank. They cannot appear anywhere else
    // (an FI functional consultant isn't an MM person, and a technical isn't functional).
    const clash = await this.prisma.moduleConsultant.findFirst({
      where: {
        userId: dto.userId,
        module: { product: { clientId } },
        NOT: { moduleId, track: dto.track, rank: dto.rank },
      },
      include: { module: { include: { product: true } } },
    });
    if (clash) {
      throw new ConflictException(
        `${staff.username} is already the ${clash.rank.toLowerCase()} ${clash.track.toLowerCase()} consultant for "${clash.module.name}" — a consultant handles only one slot`,
      );
    }
    return this.prisma.moduleConsultant.upsert({
      where: { moduleId_track_rank: { moduleId, track: dto.track, rank: dto.rank } },
      update: { userId: dto.userId },
      create: { moduleId, track: dto.track, rank: dto.rank, userId: dto.userId },
    });
  }

  /**
   * Pick the consultant to auto-assign for a module + track. Prefers the primary,
   * but falls back to the secondary when the primary already has an open ticket.
   * Returns the userId, or null when no consultant is configured.
   */
  async resolveConsultant(clientId: string, moduleId: string, track: 'TECHNICAL' | 'FUNCTIONAL'): Promise<string | null> {
    const slots = await this.prisma.moduleConsultant.findMany({
      where: { moduleId, track, module: { product: { clientId } } },
    });
    const primary = slots.find((s) => s.rank === 'PRIMARY');
    const secondary = slots.find((s) => s.rank === 'SECONDARY');
    if (!primary && !secondary) return null;

    const hasOpenTicket = async (userId: string) =>
      (await this.prisma.ticketTechnician.count({
        where: { userId, ticket: { clientId, resolvedAt: null, closedDate: null } },
      })) > 0;

    if (primary && !(await hasOpenTicket(primary.userId))) return primary.userId;
    if (secondary) return secondary.userId;         // primary busy → secondary (even if also busy)
    return primary?.userId ?? null;                 // no secondary configured → primary anyway
  }
}
