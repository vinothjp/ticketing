import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { unlink } from 'fs/promises';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCompanyDto, UpdateCompanyDto, CreateContactDto } from './dto/customer-company.dto';

export const CUSTOMER_ROLE = 'Customer';
export const CUSTOMER_ADMIN_ROLE = 'CustomerAdmin';

@Injectable()
export class CustomerCompaniesService {
  constructor(private prisma: PrismaService) {}

  /** Find-or-create the tenant's "Customer" role (contact users are assigned to it). */
  private async customerRoleId(clientId: string) {
    const existing = await this.prisma.role.findFirst({ where: { clientId, name: CUSTOMER_ROLE } });
    if (existing) return existing.id;
    const created = await this.prisma.role.create({
      data: { name: CUSTOMER_ROLE, description: 'External customer contact', clientId },
    });
    return created.id;
  }

  /** Find-or-create the tenant's "CustomerAdmin" role (a customer company's own admin). */
  private async customerAdminRoleId(clientId: string) {
    const existing = await this.prisma.role.findFirst({ where: { clientId, name: CUSTOMER_ADMIN_ROLE } });
    if (existing) return existing.id;
    const created = await this.prisma.role.create({
      data: { name: CUSTOMER_ADMIN_ROLE, description: 'Customer company administrator', clientId },
    });
    return created.id;
  }

  async list(clientId: string) {
    const companies = await this.prisma.customerCompany.findMany({
      where: { clientId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { users: true, tickets: true } } },
    });
    return companies.map((c) => ({
      id: c.id,
      name: c.name,
      code: c.code,
      contactEmail: c.contactEmail,
      contactPerson: c.contactPerson,
      contactNumber: c.contactNumber,
      logoUrl: c.logoUrl,
      status: c.status,
      maxContacts: c.maxContacts,
      agreedSupportHours: c.agreedSupportHours == null ? null : Number(c.agreedSupportHours),
      supportPeriodStart: c.supportPeriodStart,
      supportPeriodEnd: c.supportPeriodEnd,
      supportAlertThresholdPct: c.supportAlertThresholdPct,
      // Which coverage model this client is on — the tiles badge it.
      contractScope: c.contractScope,
      contactCount: c._count.users,
      ticketCount: c._count.tickets,
      createdAt: c.createdAt,
    }));
  }

  /**
   * Bare id+name list of the tenant's clients, for the ticket form's client picker.
   * `list()` above is Admin-only and exposes contract/contact detail; an agent
   * raising a ticket needs to name the client and nothing more.
   */
  async ticketClients(clientId: string) {
    return this.prisma.customerCompany.findMany({
      where: { clientId, status: 'ACTIVE' },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });
  }

  private async getOwned(id: string, clientId: string) {
    const company = await this.prisma.customerCompany.findFirst({ where: { id, clientId } });
    if (!company) throw new NotFoundException('Customer company not found');
    return company;
  }

  /** One client's core details (for the client workspace page). */
  async getOne(id: string, clientId: string) {
    const c = await this.getOwned(id, clientId);
    return {
      id: c.id, name: c.name, code: c.code, status: c.status, contactEmail: c.contactEmail,
      contactPerson: c.contactPerson, contactNumber: c.contactNumber, logoUrl: c.logoUrl,
      contractScope: c.contractScope, contractStart: c.contractStart, contractEnd: c.contractEnd, contractHours: c.contractHours,
    };
  }

  // Replace the set of products a company uses (validates ownership).
  private async setProducts(companyId: string, productIds: string[], clientId: string) {
    const valid = await this.prisma.product.findMany({ where: { id: { in: productIds }, clientId }, select: { id: true } });
    await this.prisma.customerCompanyProduct.deleteMany({ where: { customerCompanyId: companyId } });
    if (valid.length) {
      await this.prisma.customerCompanyProduct.createMany({
        data: valid.map((p) => ({ customerCompanyId: companyId, productId: p.id })),
      });
    }
  }

  async getProducts(companyId: string, clientId: string) {
    await this.getOwned(companyId, clientId);
    const links = await this.prisma.customerCompanyProduct.findMany({ where: { customerCompanyId: companyId } });
    return links.map((l) => l.productId);
  }

  /**
   * Products (with modules, no consultant detail) a viewer may raise tickets for.
   * Always scoped to one customer company — the products actually assigned to it,
   * never the whole catalogue. A customer's company is their own; staff pass the
   * client they picked on the ticket form, so with no client chosen there is
   * nothing to offer yet.
   */
  /**
   * The tenant's whole active catalogue, for an INTERNAL ticket — one raised with
   * no client on it, so no customer contract scopes the list. Same projection as
   * `ticketProducts` so the ticket form renders both the same way.
   */
  internalTicketProducts(clientId: string) {
    return this.prisma.product.findMany({
      where: { clientId, isActive: true },
      orderBy: [{ sortOrder: 'asc' }],
      select: { id: true, name: true, code: true, autoAssign: true, modules: { select: { id: true, name: true, tracks: true }, orderBy: [{ sortOrder: 'asc' }] } },
    });
  }

  async ticketProducts(clientId: string, customerCompanyId: string | null) {
    if (!customerCompanyId) return [];
    // Only products whose AMC is still active — expired/terminated ones drop off.
    const links = await this.prisma.customerCompanyProduct.findMany({ where: { customerCompanyId, status: 'ACTIVE' } });
    if (links.length === 0) return [];
    return this.prisma.product.findMany({
      where: { clientId, isActive: true, id: { in: links.map((l) => l.productId) } },
      orderBy: [{ sortOrder: 'asc' }],
      select: { id: true, name: true, code: true, autoAssign: true, modules: { select: { id: true, name: true, tracks: true }, orderBy: [{ sortOrder: 'asc' }] } },
    });
  }

  async create(dto: CreateCompanyDto, clientId: string, actorId: string) {
    const dup = await this.prisma.customerCompany.findFirst({ where: { clientId, name: dto.name } });
    if (dup) throw new ConflictException('A customer company with this name already exists');

    // If a bootstrap admin is supplied, all three fields are required and the
    // login must not clash with an existing user.
    const wantsAdmin = !!(dto.adminUsername || dto.adminEmail || dto.adminPassword);
    if (wantsAdmin && !(dto.adminUsername && dto.adminEmail && dto.adminPassword)) {
      throw new BadRequestException('Provide username, email and password for the first admin');
    }
    if (wantsAdmin) {
      const clash = await this.prisma.user.findFirst({
        where: { OR: [{ username: dto.adminUsername! }, { email: dto.adminEmail! }] },
      });
      if (clash) throw new ConflictException('Admin username or email already exists');
    }

    const company = await this.prisma.customerCompany.create({
      data: {
        clientId,
        name: dto.name,
        code: dto.code,
        contactEmail: dto.contactEmail,
        contactPerson: dto.contactPerson,
        contactNumber: dto.contactNumber,
        maxContacts: dto.maxContacts ?? 5,
        status: dto.status ?? 'ACTIVE',
        agreedSupportHours: dto.agreedSupportHours ?? null,
        supportPeriodStart: dto.supportPeriodStart ? new Date(dto.supportPeriodStart) : null,
        supportPeriodEnd: dto.supportPeriodEnd ? new Date(dto.supportPeriodEnd) : null,
        supportAlertThresholdPct: dto.supportAlertThresholdPct ?? 70,
        createdBy: actorId,
        updatedBy: actorId,
      },
    });

    if (wantsAdmin) {
      const roleId = await this.customerAdminRoleId(clientId);
      const passwordHash = await bcrypt.hash(dto.adminPassword!, 12);
      await this.prisma.user.create({
        data: {
          username: dto.adminUsername!,
          email: dto.adminEmail!,
          passwordHash,
          clientId,
          customerCompanyId: company.id,
          createdBy: actorId,
          updatedBy: actorId,
          userRoles: { create: [{ roleId, createdBy: actorId }] },
        },
      });
    }

    if (dto.productIds) await this.setProducts(company.id, dto.productIds, clientId);
    return company;
  }

  async update(id: string, dto: UpdateCompanyDto, clientId: string, actorId: string) {
    await this.getOwned(id, clientId);
    if (dto.name) {
      const dup = await this.prisma.customerCompany.findFirst({
        where: { clientId, name: dto.name, id: { not: id } },
      });
      if (dup) throw new ConflictException('A customer company with this name already exists');
    }
    const { productIds, supportPeriodStart, supportPeriodEnd, ...rest } = dto;
    // Re-arm the "hours low" alert whenever the pool is (re)configured, so a new
    // period or a raised cap can trigger a fresh alert.
    const poolChanged = ['agreedSupportHours', 'supportPeriodStart', 'supportPeriodEnd', 'supportAlertThresholdPct']
      .some((k) => k in dto);
    const company = await this.prisma.customerCompany.update({
      where: { id },
      data: {
        ...rest,
        ...(supportPeriodStart !== undefined ? { supportPeriodStart: supportPeriodStart ? new Date(supportPeriodStart) : null } : {}),
        ...(supportPeriodEnd !== undefined ? { supportPeriodEnd: supportPeriodEnd ? new Date(supportPeriodEnd) : null } : {}),
        ...(poolChanged ? { supportAlertSentAt: null } : {}),
        updatedBy: actorId,
      },
    });
    if (productIds) await this.setProducts(id, productIds, clientId);
    return company;
  }

  // ---- Logo (same convention as Client.logoUrl: a path under /uploads/logos) --

  async setLogo(id: string, logoUrl: string, clientId: string, actorId: string) {
    const company = await this.getOwned(id, clientId);
    if (company.logoUrl) await this.deleteLogoFile(company.logoUrl);
    await this.prisma.customerCompany.update({ where: { id }, data: { logoUrl, updatedBy: actorId } });
    return this.getOne(id, clientId);
  }

  async removeLogo(id: string, clientId: string, actorId: string) {
    const company = await this.getOwned(id, clientId);
    if (company.logoUrl) await this.deleteLogoFile(company.logoUrl);
    await this.prisma.customerCompany.update({ where: { id }, data: { logoUrl: null, updatedBy: actorId } });
    return this.getOne(id, clientId);
  }

  private async deleteLogoFile(logoUrl: string) {
    try {
      await unlink(join(process.cwd(), logoUrl.replace(/^\//, '')));
    } catch {
      // best-effort cleanup — file may already be gone
    }
  }

  async remove(id: string, clientId: string) {
    await this.getOwned(id, clientId);
    const contacts = await this.prisma.user.count({ where: { customerCompanyId: id } });
    if (contacts > 0) {
      throw new BadRequestException('Remove the company’s contact users before deleting it');
    }
    // Tickets keep their history; the FK is ON DELETE SET NULL.
    await this.prisma.customerCompany.delete({ where: { id } });
    return { message: 'Customer company deleted' };
  }

  // ---- Contacts (external login users of a company) --------------------------

  async listContacts(companyId: string, clientId: string) {
    await this.getOwned(companyId, clientId);
    return this.prisma.user.findMany({
      where: { customerCompanyId: companyId },
      select: { id: true, username: true, email: true, isActive: true, createdAt: true },
      orderBy: { username: 'asc' },
    });
  }

  async addContact(companyId: string, dto: CreateContactDto, clientId: string, actorId: string) {
    const company = await this.getOwned(companyId, clientId);

    const count = await this.prisma.user.count({ where: { customerCompanyId: companyId } });
    if (count >= company.maxContacts) {
      throw new BadRequestException(`This company has reached its limit of ${company.maxContacts} contact users`);
    }

    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ username: dto.username }, { email: dto.email }] },
    });
    if (existing) throw new ConflictException('Username or email already exists');

    const roleId = await this.customerRoleId(clientId);
    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.prisma.user.create({
      data: {
        username: dto.username,
        email: dto.email,
        passwordHash,
        clientId,
        customerCompanyId: companyId,
        createdBy: actorId,
        updatedBy: actorId,
        userRoles: { create: [{ roleId, createdBy: actorId }] },
      },
    });
    return { id: user.id, username: user.username, email: user.email };
  }

  async removeContact(companyId: string, userId: string, clientId: string) {
    await this.getOwned(companyId, clientId);
    const user = await this.prisma.user.findFirst({ where: { id: userId, customerCompanyId: companyId } });
    if (!user) throw new NotFoundException('Contact not found');
    await this.prisma.user.delete({ where: { id: userId } });
    return { message: 'Contact removed' };
  }
}
