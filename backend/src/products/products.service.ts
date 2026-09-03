import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateProductDto, UpdateProductDto, CreateModuleDto, UpdateModuleDto, AddConsultantDto,
} from './dto/product.dto';

const PRODUCT_INCLUDE = {
  consultants: { include: { user: { select: { id: true, username: true } } } },
  modules: {
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: { consultants: { include: { user: { select: { id: true, username: true } } } } },
  },
} satisfies Prisma.ProductInclude;

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  list(clientId: string) {
    return this.prisma.product.findMany({
      where: { clientId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: PRODUCT_INCLUDE,
    });
  }

  async getOne(id: string, clientId: string) {
    const p = await this.prisma.product.findFirst({ where: { id, clientId }, include: PRODUCT_INCLUDE });
    if (!p) throw new NotFoundException('Product not found');
    return p;
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
        imageUrl: dto.imageUrl || null,
        tracks: dto.tracks ?? [], sortOrder: count,
      },
    });
  }

  async updateProduct(id: string, dto: UpdateProductDto, clientId: string) {
    await this.ownedProduct(id, clientId);
    // Dropping a product-level track removes any agents listed under it.
    if (dto.tracks) {
      await this.prisma.productConsultant.deleteMany({ where: { productId: id, track: { notIn: dto.tracks } } });
    }
    return this.prisma.product.update({
      where: { id },
      data: {
        name: dto.name?.trim(), code: dto.code?.trim(),
        ...(dto.description !== undefined ? { description: dto.description.trim() || null } : {}),
        ...(dto.imageUrl !== undefined ? { imageUrl: dto.imageUrl || null } : {}),
        ...(dto.tracks !== undefined ? { tracks: dto.tracks } : {}),
        isActive: dto.isActive,
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
    return this.prisma.productModule.create({ data: { productId, name: dto.name.trim(), tracks: dto.tracks ?? [], sortOrder: count } });
  }

  async updateModule(moduleId: string, dto: UpdateModuleDto, clientId: string) {
    await this.ownedModule(moduleId, clientId);
    if (dto.tracks) {
      await this.prisma.moduleConsultant.deleteMany({ where: { moduleId, track: { notIn: dto.tracks } } });
    }
    return this.prisma.productModule.update({
      where: { id: moduleId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.tracks !== undefined ? { tracks: dto.tracks } : {}),
      },
    });
  }

  async removeModule(moduleId: string, clientId: string) {
    await this.ownedModule(moduleId, clientId);
    await this.prisma.productModule.delete({ where: { id: moduleId } });
    return { message: 'Module deleted' };
  }

  // ---- module-level agents ----

  async addConsultant(moduleId: string, dto: AddConsultantDto, clientId: string) {
    const mod = await this.ownedModule(moduleId, clientId);
    const staff = await this.prisma.user.findFirst({ where: { id: dto.userId, clientId } });
    if (!staff) throw new NotFoundException('User not found');
    const existing = await this.prisma.moduleConsultant.findMany({ where: { moduleId, track: dto.track } });
    if (existing.some((c) => c.userId === dto.userId)) {
      throw new ConflictException(`${staff.username} is already in this list`);
    }
    // The grid has no separate "add track" step — registering an agent adds the track.
    if (!mod.tracks.includes(dto.track)) {
      await this.prisma.productModule.update({ where: { id: moduleId }, data: { tracks: { push: dto.track } } });
    }
    return this.prisma.moduleConsultant.create({
      data: { moduleId, track: dto.track, userId: dto.userId, isPrimary: existing.length === 0, sortOrder: existing.length },
    });
  }

  async removeConsultant(moduleId: string, consultantId: string, clientId: string) {
    await this.ownedModule(moduleId, clientId);
    const row = await this.prisma.moduleConsultant.findFirst({ where: { id: consultantId, moduleId } });
    if (!row) throw new NotFoundException('Consultant not found');
    await this.prisma.moduleConsultant.delete({ where: { id: consultantId } });
    if (row.isPrimary) {
      const next = await this.prisma.moduleConsultant.findFirst({ where: { moduleId, track: row.track }, orderBy: { sortOrder: 'asc' } });
      if (next) await this.prisma.moduleConsultant.update({ where: { id: next.id }, data: { isPrimary: true } });
    }
    return { message: 'Consultant removed' };
  }

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

  // ---- product-level agents (no module) ----

  async addProductConsultant(productId: string, dto: AddConsultantDto, clientId: string) {
    const product = await this.ownedProduct(productId, clientId);
    const staff = await this.prisma.user.findFirst({ where: { id: dto.userId, clientId } });
    if (!staff) throw new NotFoundException('User not found');
    const existing = await this.prisma.productConsultant.findMany({ where: { productId, track: dto.track } });
    if (existing.some((c) => c.userId === dto.userId)) {
      throw new ConflictException(`${staff.username} is already in this list`);
    }
    if (!product.tracks.includes(dto.track)) {
      await this.prisma.product.update({ where: { id: productId }, data: { tracks: { push: dto.track } } });
    }
    return this.prisma.productConsultant.create({
      data: { productId, track: dto.track, userId: dto.userId, isPrimary: existing.length === 0, sortOrder: existing.length },
    });
  }

  async removeProductConsultant(productId: string, consultantId: string, clientId: string) {
    await this.ownedProduct(productId, clientId);
    const row = await this.prisma.productConsultant.findFirst({ where: { id: consultantId, productId } });
    if (!row) throw new NotFoundException('Consultant not found');
    await this.prisma.productConsultant.delete({ where: { id: consultantId } });
    if (row.isPrimary) {
      const next = await this.prisma.productConsultant.findFirst({ where: { productId, track: row.track }, orderBy: { sortOrder: 'asc' } });
      if (next) await this.prisma.productConsultant.update({ where: { id: next.id }, data: { isPrimary: true } });
    }
    return { message: 'Consultant removed' };
  }

  async setProductPrimary(productId: string, consultantId: string, clientId: string) {
    await this.ownedProduct(productId, clientId);
    const row = await this.prisma.productConsultant.findFirst({ where: { id: consultantId, productId } });
    if (!row) throw new NotFoundException('Consultant not found');
    await this.prisma.$transaction([
      this.prisma.productConsultant.updateMany({ where: { productId, track: row.track }, data: { isPrimary: false } }),
      this.prisma.productConsultant.update({ where: { id: consultantId }, data: { isPrimary: true } }),
    ]);
    return { message: 'Primary updated' };
  }

  /**
   * Pick the consultant to auto-assign for a module + track (ticket routing).
   * The query's `isPrimary desc, sortOrder asc` order IS the walk order — the
   * primary leads, and the first candidate the caller accepts takes the ticket.
   */
  async resolveConsultant(clientId: string, moduleId: string, track: 'TECHNICAL' | 'FUNCTIONAL' | null, isEligible: (userId: string) => boolean): Promise<string | null> {
    const agents = await this.prisma.moduleConsultant.findMany({
      // No track on the ticket (single-track or unsplit module) — any agent will do.
      where: { moduleId, ...(track ? { track } : {}), module: { product: { clientId } } },
      orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
    });
    return this.firstAvailable(agents, isEligible);
  }

  /**
   * Product-screen consultants for a product that isn't split into modules
   * (or whose module carries no list). Same primary-then-list-order walk.
   */
  async resolveProductConsultant(clientId: string, productId: string, track: 'TECHNICAL' | 'FUNCTIONAL' | null, isEligible: (userId: string) => boolean): Promise<string | null> {
    const agents = await this.prisma.productConsultant.findMany({
      where: { productId, ...(track ? { track } : {}), product: { clientId } },
      orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
    });
    return this.firstAvailable(agents, isEligible);
  }

  /**
   * The first agent in the caller's order the caller will accept. The order is
   * the primary first, since every query sorts `isPrimary desc, sortOrder asc`;
   * `isEligible` is the availability test — an active staff user holding no open
   * ticket — computed once per routing pass in `TicketsService.create()` and
   * threaded down, so a five-tier walk never issues a per-candidate count.
   *
   * Routing IS balanced by availability: a consultant already holding an open
   * ticket is skipped and the next name in the list takes it. A tier is left
   * only when every candidate in it is busy or inactive, and when no tier has
   * anyone free the ticket stays unassigned — there is deliberately no fallback
   * to the primary.
   */
  private firstAvailable(agents: { userId: string }[], isEligible: (userId: string) => boolean): string | null {
    return agents.find((a) => isEligible(a.userId))?.userId ?? null;
  }
}
