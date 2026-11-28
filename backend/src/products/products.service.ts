import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateProductDto, UpdateProductDto, CreateModuleDto, UpdateModuleDto, AddConsultantDto,
} from './dto/product.dto';
import { type AgentPicker, type IssueType } from '../tickets/auto-assign';

const PRODUCT_INCLUDE = {
  consultants: { include: { user: { select: { id: true, username: true, name: true } } } },
  modules: {
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: { consultants: { include: { user: { select: { id: true, username: true, name: true } } } } },
  },
} satisfies Prisma.ProductInclude;

/** The Others column holds every track that is neither Technical nor Functional. */
const trackWhere = (track: IssueType) =>
  track === 'OTHERS' ? { notIn: ['TECHNICAL', 'FUNCTIONAL'] } : track;

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
        consultantMode: dto.consultantMode ?? 'PRODUCT',
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
    if (!dto.name.trim()) throw new BadRequestException('Module name is required');
    const count = await this.prisma.productModule.count({ where: { productId } });
    return this.prisma.productModule.create({ data: { productId, name: dto.name.trim(), tracks: dto.tracks ?? [], sortOrder: count } });
  }

  async updateModule(moduleId: string, dto: UpdateModuleDto, clientId: string) {
    await this.ownedModule(moduleId, clientId);
    // @IsNotEmpty passes '   ', which the trim below would store as a blank name.
    if (dto.name !== undefined && !dto.name.trim()) throw new BadRequestException('Module name is required');
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
    this.assertMode(await this.ownedProduct(mod.productId, clientId), 'MODULES');
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
    this.assertMode(product, 'PRODUCT');
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
   * Auto-routing's Products-screen step for a module + issue type. The query's
   * `isPrimary desc, sortOrder asc` order is the priority order `pick` breaks
   * ties on; `pick` (built once per routing pass in `TicketsService`) chooses the
   * least-loaded agent below the organization's max.
   */
  async resolveConsultant(clientId: string, moduleId: string, track: IssueType, pick: AgentPicker): Promise<string | null> {
    const agents = await this.prisma.moduleConsultant.findMany({
      where: { moduleId, track: trackWhere(track), module: { product: { clientId } } },
      orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
    });
    return pick(agents.map((a) => a.userId));
  }

  /** The same step for a product assigned as a whole (`consultantMode` PRODUCT). */
  async resolveProductConsultant(clientId: string, productId: string, track: IssueType, pick: AgentPicker): Promise<string | null> {
    const agents = await this.prisma.productConsultant.findMany({
      where: { productId, track: trackWhere(track), product: { clientId } },
      orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
    });
    return pick(agents.map((a) => a.userId));
  }

  /**
   * The "Assign consultants" switch (Whole product ⇄ Modules). Only one mode's
   * consultants may exist (client request), so switching deletes the other
   * mode's — on the Products screen and on every client's product page — and
   * those people are free to be picked again in the new layout. Re-picking the
   * current mode changes nothing.
   */
  async setConsultantMode(id: string, mode: 'PRODUCT' | 'MODULES', clientId: string) {
    const product = await this.ownedProduct(id, clientId);
    if (product.consultantMode === mode) return { mode, removed: { product: 0, clients: 0 } };
    const [productRows, clientRows] = await this.prisma.$transaction(async (tx) => {
      const own = mode === 'MODULES'
        ? await tx.productConsultant.deleteMany({ where: { productId: id } })
        : await tx.moduleConsultant.deleteMany({ where: { module: { productId: id } } });
      const clients = await tx.customerConsultant.deleteMany({
        where: { clientId, productId: id, moduleId: mode === 'MODULES' ? null : { not: null } },
      });
      await tx.product.update({ where: { id }, data: { consultantMode: mode } });
      return [own.count, clients.count];
    });
    return { mode, removed: { product: productRows, clients: clientRows } };
  }

  private assertMode(product: { consultantMode: string }, mode: 'PRODUCT' | 'MODULES') {
    if (product.consultantMode !== mode) {
      throw new BadRequestException(
        mode === 'MODULES'
          ? 'This product assigns consultants to the whole product — switch it to Modules first'
          : 'This product assigns consultants per module — switch it to Whole product first',
      );
    }
  }
}
