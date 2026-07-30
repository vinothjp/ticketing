import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCompanyDto, UpdateCompanyDto, CreateContactDto } from './dto/customer-company.dto';

export const CUSTOMER_ROLE = 'Customer';

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
      status: c.status,
      maxContacts: c.maxContacts,
      contactCount: c._count.users,
      ticketCount: c._count.tickets,
      createdAt: c.createdAt,
    }));
  }

  private async getOwned(id: string, clientId: string) {
    const company = await this.prisma.customerCompany.findFirst({ where: { id, clientId } });
    if (!company) throw new NotFoundException('Customer company not found');
    return company;
  }

  async create(dto: CreateCompanyDto, clientId: string, actorId: string) {
    const dup = await this.prisma.customerCompany.findFirst({ where: { clientId, name: dto.name } });
    if (dup) throw new ConflictException('A customer company with this name already exists');
    return this.prisma.customerCompany.create({
      data: {
        clientId,
        name: dto.name,
        code: dto.code,
        contactEmail: dto.contactEmail,
        maxContacts: dto.maxContacts ?? 5,
        status: dto.status ?? 'ACTIVE',
        createdBy: actorId,
        updatedBy: actorId,
      },
    });
  }

  async update(id: string, dto: UpdateCompanyDto, clientId: string, actorId: string) {
    await this.getOwned(id, clientId);
    if (dto.name) {
      const dup = await this.prisma.customerCompany.findFirst({
        where: { clientId, name: dto.name, id: { not: id } },
      });
      if (dup) throw new ConflictException('A customer company with this name already exists');
    }
    return this.prisma.customerCompany.update({
      where: { id },
      data: { ...dto, updatedBy: actorId },
    });
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
