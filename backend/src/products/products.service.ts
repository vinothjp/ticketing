import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateProductDto, UpdateProductDto, CreateModuleDto, UpdateModuleDto, AddConsultantDto,
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
      data: {
        clientId, name: dto.name.trim(), code: dto.code.trim(),
        description: dto.description?.trim() || null,
        autoAssign: dto.autoAssign ?? true, sortOrder: count,
      },
    });
  }

  async updateProduct(id: string, dto: UpdateProductDto, clientId: string) {
    await this.ownedProduct(id, clientId);
    return this.prisma.product.update({
      where: { id },
      data: {
        name: dto.name?.trim(), code: dto.code?.trim(),
        ...(dto.description !== undefined ? { description: dto.description.trim() || null } : {}),
        autoAssign: dto.autoAssign, isActive: dto.isActive,
      },
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
    const tracks = dto.tracks?.length ? dto.tracks : ['TECHNICAL', 'FUNCTIONAL'];
    return this.prisma.productModule.create({ data: { productId, name: dto.name.trim(), tracks, sortOrder: count } });
  }

  async updateModule(moduleId: string, dto: UpdateModuleDto, clientId: string) {
    await this.ownedModule(moduleId, clientId);
    // Dropping a track cleans out any agents that were listed under it.
    if (dto.tracks) {
      await this.prisma.moduleConsultant.deleteMany({ where: { moduleId, track: { notIn: dto.tracks } } });
    }
    return this.prisma.productModule.update({
      where: { id: moduleId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.tracks !== undefined ? { tracks: dto.tracks.length ? dto.tracks : ['TECHNICAL', 'FUNCTIONAL'] } : {}),
      },
    });
  }

  async removeModule(moduleId: string, clientId: string) {
    await this.ownedModule(moduleId, clientId);
    await this.prisma.productModule.delete({ where: { id: moduleId } });
    return { message: 'Module deleted' };
  }

  // Add an agent to a module's consultant list for a track. The first agent added
  // becomes the primary automatically.
  async addConsultant(moduleId: string, dto: AddConsultantDto, clientId: string) {
    await this.ownedModule(moduleId, clientId);
    const staff = await this.prisma.user.findFirst({ where: { id: dto.userId, clientId } });
    if (!staff) throw new NotFoundException('User not found');

    // A consultant is a specialist for exactly one slot — they may appear in a
    // single module+track list and nowhere else.
    const clash = await this.prisma.moduleConsultant.findFirst({
      where: { userId: dto.userId, module: { product: { clientId } }, NOT: { moduleId, track: dto.track } },
      include: { module: true },
    });
    if (clash) {
      throw new ConflictException(
        `${staff.username} is already a ${clash.track.toLowerCase()} consultant for "${clash.module.name}" — a consultant handles only one module/track`,
      );
    }

    const existing = await this.prisma.moduleConsultant.findMany({ where: { moduleId, track: dto.track } });
    if (existing.some((c) => c.userId === dto.userId)) {
      throw new ConflictException(`${staff.username} is already in this list`);
    }
    return this.prisma.moduleConsultant.create({
      data: {
        moduleId, track: dto.track, userId: dto.userId,
        isPrimary: existing.length === 0,       // first agent in the list is primary
        sortOrder: existing.length,
      },
    });
  }

  // Remove an agent from a list; if they were the primary, promote the next one.
  async removeConsultant(moduleId: string, consultantId: string, clientId: string) {
    await this.ownedModule(moduleId, clientId);
    const row = await this.prisma.moduleConsultant.findFirst({ where: { id: consultantId, moduleId } });
    if (!row) throw new NotFoundException('Consultant not found');
    await this.prisma.moduleConsultant.delete({ where: { id: consultantId } });

    if (row.isPrimary) {
      const next = await this.prisma.moduleConsultant.findFirst({
        where: { moduleId, track: row.track }, orderBy: { sortOrder: 'asc' },
      });
      if (next) await this.prisma.moduleConsultant.update({ where: { id: next.id }, data: { isPrimary: true } });
    }
    return { message: 'Consultant removed' };
  }

  // Make one agent the primary for its module+track (demotes the current primary).
  async setPrimary(moduleId: string, consultantId: string, clientId: string) {
    await this.ownedModule(moduleId, clientId);
    const row = await this.prisma.moduleConsultant.findFirst({ where: { id: consultantId, moduleId } });
    if (!row) throw new NotFoundException('Consultant not found');
    await this.prisma.$transaction([
      this.prisma.moduleConsultant.updateMany({ where: { moduleId, track: row.track }, data: { isPrimary: false } }),
      this.prisma.moduleConsultant.update({ where: { id: consultantId }, data: { isPrimary: true } }),
    ]);
    return { message: 'Primary updated' };
  }

  /**
   * Pick the consultant to auto-assign for a module + track. Prefers the primary,
   * then falls back through the rest of the list (in order) to the first agent
   * without an open ticket. Returns the userId, or null when the list is empty.
   */
  async resolveConsultant(clientId: string, moduleId: string, track: 'TECHNICAL' | 'FUNCTIONAL'): Promise<string | null> {
    const agents = await this.prisma.moduleConsultant.findMany({
      where: { moduleId, track, module: { product: { clientId } } },
      orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
    });
    if (agents.length === 0) return null;

    const hasOpenTicket = async (userId: string) =>
      (await this.prisma.ticketTechnician.count({
        where: { userId, ticket: { clientId, resolvedAt: null, closedDate: null } },
      })) > 0;

    for (const a of agents) {
      if (!(await hasOpenTicket(a.userId))) return a.userId;
    }
    return agents[0].userId;                         // everyone busy → the primary anyway
  }
}
