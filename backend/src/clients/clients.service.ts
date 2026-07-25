import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { UpsertLicenseDto } from './dto/upsert-license.dto';
import { CreateClientUserDto } from './dto/create-client-user.dto';
import * as bcrypt from 'bcryptjs';
import { join } from 'path';
import { unlink } from 'fs/promises';

@Injectable()
export class ClientsService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.client.findMany({
      include: { license: true, _count: { select: { users: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const client = await this.prisma.client.findUnique({
      where: { id },
      include: {
        license: true,
        _count: { select: { users: true } },
        users: {
          select: {
            id: true,
            username: true,
            email: true,
            isActive: true,
            createdAt: true,
            userRoles: { include: { role: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!client) throw new NotFoundException('Client not found');
    return client;
  }

  private async createAdminUserForClient(
    tx: Prisma.TransactionClient,
    clientId: string,
    dto: { username: string; email: string; password: string },
    actorId: string,
  ) {
    let adminRole = await tx.role.findFirst({ where: { clientId, name: 'Admin' } });
    if (!adminRole) {
      adminRole = await tx.role.create({
        data: { name: 'Admin', description: 'Full access to all forms', clientId, createdBy: actorId, updatedBy: actorId },
      });

      const forms = await tx.appForm.findMany();
      if (forms.length) {
        await tx.formPermission.createMany({
          data: forms.map((form) => ({
            roleId: adminRole!.id,
            formId: form.id,
            canCreate: true,
            canUpdate: true,
            canView: true,
            canDelete: true,
            canExport: true,
            canImport: true,
            createdBy: actorId,
            updatedBy: actorId,
          })),
        });
      }
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await tx.user.create({
      data: { username: dto.username, email: dto.email, passwordHash, clientId, createdBy: actorId, updatedBy: actorId },
    });
    await tx.userRole.create({ data: { userId: user.id, roleId: adminRole.id, createdBy: actorId } });
    return user;
  }

  async create(dto: CreateClientDto, actorId: string) {
    const existing = await this.prisma.client.findUnique({ where: { code: dto.code } });
    if (existing) throw new ConflictException('Client code already exists');

    if (dto.createAdminUser) {
      const existingUser = await this.prisma.user.findFirst({
        where: { OR: [{ username: dto.adminUsername }, { email: dto.adminEmail }] },
      });
      if (existingUser) throw new ConflictException('Admin username or email already exists');
    }

    const clientId = await this.prisma.$transaction(async (tx) => {
      const client = await tx.client.create({
        data: {
          name: dto.name,
          code: dto.code,
          contactEmail: dto.contactEmail,
          contactPhone: dto.contactPhone,
          status: dto.status,
          createdBy: actorId,
          updatedBy: actorId,
        },
      });

      if (dto.createLicense) {
        await tx.license.create({
          data: {
            clientId: client.id,
            plan: dto.licensePlan!,
            maxUsers: dto.licenseMaxUsers!,
            startDate: new Date(dto.licenseStartDate!),
            expiryDate: new Date(dto.licenseExpiryDate!),
            status: dto.licenseStatus ?? 'ACTIVE',
            notes: dto.licenseNotes,
            createdBy: actorId,
            updatedBy: actorId,
          },
        });
      }

      if (dto.createAdminUser) {
        await this.createAdminUserForClient(tx, client.id, {
          username: dto.adminUsername!,
          email: dto.adminEmail!,
          password: dto.adminPassword!,
        }, actorId);
      }

      return client.id;
    });

    return this.findOne(clientId);
  }

  async createUser(clientId: string, dto: CreateClientUserDto, actorId: string) {
    await this.findOne(clientId);
    const existingUser = await this.prisma.user.findFirst({
      where: { OR: [{ username: dto.username }, { email: dto.email }] },
    });
    if (existingUser) throw new ConflictException('Username or email already exists');

    await this.prisma.$transaction((tx) => this.createAdminUserForClient(tx, clientId, dto, actorId));
    return this.findOne(clientId);
  }

  async update(id: string, dto: UpdateClientDto, actorId: string) {
    await this.findOne(id);
    if (dto.code) {
      const existing = await this.prisma.client.findUnique({ where: { code: dto.code } });
      if (existing && existing.id !== id) throw new ConflictException('Client code already exists');
    }
    return this.prisma.client.update({ where: { id }, data: { ...dto, updatedBy: actorId } });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.client.delete({ where: { id } });
    return { message: 'Client deleted' };
  }

  async setLogo(id: string, logoUrl: string, actorId: string) {
    const client = await this.findOne(id);
    if (client.logoUrl) await this.deleteLogoFile(client.logoUrl);
    await this.prisma.client.update({ where: { id }, data: { logoUrl, updatedBy: actorId } });
    return this.findOne(id);
  }

  async removeLogo(id: string, actorId: string) {
    const client = await this.findOne(id);
    if (client.logoUrl) await this.deleteLogoFile(client.logoUrl);
    await this.prisma.client.update({ where: { id }, data: { logoUrl: null, updatedBy: actorId } });
    return this.findOne(id);
  }

  private async deleteLogoFile(logoUrl: string) {
    try {
      await unlink(join(process.cwd(), logoUrl.replace(/^\//, '')));
    } catch {
      // best-effort cleanup — file may already be gone
    }
  }

  async upsertLicense(clientId: string, dto: UpsertLicenseDto, actorId: string) {
    await this.findOne(clientId);
    return this.prisma.license.upsert({
      where: { clientId },
      update: {
        plan: dto.plan,
        maxUsers: dto.maxUsers,
        startDate: new Date(dto.startDate),
        expiryDate: new Date(dto.expiryDate),
        status: dto.status ?? 'ACTIVE',
        notes: dto.notes,
        updatedBy: actorId,
      },
      create: {
        clientId,
        plan: dto.plan,
        maxUsers: dto.maxUsers,
        startDate: new Date(dto.startDate),
        expiryDate: new Date(dto.expiryDate),
        status: dto.status ?? 'ACTIVE',
        notes: dto.notes,
        createdBy: actorId,
        updatedBy: actorId,
      },
    });
  }
}
