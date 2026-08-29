import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

/**
 * What every user read returns. Internal staff *are* the employees, so the
 * Employee Master fields ride on the user row — and because this is a hand-built
 * projection, a column added to the schema reaches no screen until it is listed
 * here.
 */
const USER_SELECT = {
  id: true,
  username: true,
  name: true,
  email: true,
  isActive: true,
  createdAt: true,
  employeeId: true,
  department: true,
  designation: true,
  phone: true,
  managerId: true,
  manager: { select: { id: true, name: true, username: true } },
  userRoles: { include: { role: true } },
};

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  // Customer contacts (customerCompanyId set) are excluded unless explicitly requested,
  // so assignee/owner pickers only ever show staff. The Users admin page opts in.
  async findAll(clientId: string, includeCustomers = false) {
    return this.prisma.user.findMany({
      where: { clientId, ...(includeCustomers ? {} : { customerCompanyId: null }) },
      select: USER_SELECT,
    });
  }

  async findOne(id: string, clientId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, clientId },
      select: USER_SELECT,
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async create(dto: CreateUserDto, clientId: string, actorId: string) {
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ username: dto.username }, { email: dto.email }] },
    });
    if (existing) throw new ConflictException('Username or email already exists');

    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      include: { license: true },
    });
    if (!client?.license || client.license.status !== 'ACTIVE' || client.license.expiryDate < new Date()) {
      throw new BadRequestException('No active license for this organization');
    }

    const activeUserCount = await this.prisma.user.count({ where: { clientId } });
    if (activeUserCount >= client.license.maxUsers) {
      throw new BadRequestException('User seat limit reached for your license');
    }

    const employeeId = dto.employeeId?.trim() || null;
    if (employeeId) await this.assertEmployeeIdFree(clientId, employeeId);
    if (dto.managerId) await this.assertManager(dto.managerId, clientId);

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.prisma.user.create({
      data: {
        username: dto.username,
        name: dto.name?.trim() || null,
        email: dto.email,
        passwordHash,
        clientId,
        employeeId,
        department: dto.department?.trim() || null,
        designation: dto.designation?.trim() || null,
        phone: dto.phone?.trim() || null,
        managerId: dto.managerId || null,
        createdBy: actorId,
        updatedBy: actorId,
      },
    });
    return { id: user.id, username: user.username, name: user.name, email: user.email };
  }

  async update(id: string, dto: UpdateUserDto, clientId: string, actorId: string) {
    await this.findOne(id, clientId);
    // Guard the unique username/email so a clash returns 409, not a raw 500.
    if (dto.username || dto.email) {
      const conflict = await this.prisma.user.findFirst({
        where: {
          id: { not: id },
          OR: [
            ...(dto.username ? [{ username: dto.username }] : []),
            ...(dto.email ? [{ email: dto.email }] : []),
          ],
        },
      });
      if (conflict) throw new ConflictException('Username or email already exists');
    }

    const data: Record<string, unknown> = { ...dto, updatedBy: actorId };
    if (typeof data.name === 'string') data.name = (data.name as string).trim() || null;

    // Employee fields: an emptied box arrives as '' or null and clears the value.
    for (const field of ['employeeId', 'department', 'designation', 'phone'] as const) {
      if (dto[field] !== undefined) data[field] = dto[field]?.trim() || null;
    }
    if (data.employeeId) await this.assertEmployeeIdFree(clientId, data.employeeId as string, id);
    if (dto.managerId !== undefined) {
      data.managerId = dto.managerId || null;
      if (data.managerId) {
        if (data.managerId === id) throw new BadRequestException('A user cannot be their own manager');
        await this.assertManager(data.managerId as string, clientId);
      }
    }

    if (dto.password) {
      data.passwordHash = await bcrypt.hash(dto.password, 12);
      delete data.password;
    }
    await this.prisma.user.update({ where: { id }, data });
    return this.findOne(id, clientId);
  }

  async remove(id: string, clientId: string) {
    await this.findOne(id, clientId);
    await this.prisma.user.delete({ where: { id } });
    return { message: 'User deleted' };
  }

  /**
   * An employee id identifies one person inside the tenant. NULLs are distinct in
   * Postgres, so staff without one never collide; the DB unique index is the
   * backstop and this is the friendly 409.
   */
  private async assertEmployeeIdFree(clientId: string, employeeId: string, ignoreId?: string) {
    const clash = await this.prisma.user.findFirst({
      where: { clientId, employeeId, ...(ignoreId ? { NOT: { id: ignoreId } } : {}) },
      select: { name: true, username: true },
    });
    if (clash) {
      throw new ConflictException(
        `Employee ID ${employeeId} is already assigned to ${clash.name || clash.username}`,
      );
    }
  }

  /**
   * A manager is a staff user of this tenant carrying the **Manager** role — the
   * shape the Employee Master header picks from, and the person an asset request
   * is routed to for approval.
   *
   * Deliberately not the Admin role: Admin is an administrative right over the
   * tenant, not a reporting line, and conflating the two put every admin in every
   * employee's manager dropdown. Manager is layered on top of `Viewer` rather
   * than replacing it — a manager is still internal staff, and every existing
   * staff gate reads `Viewer`.
   */
  private async assertManager(managerId: string, clientId: string) {
    const manager = await this.prisma.user.findFirst({
      where: {
        id: managerId,
        clientId,
        customerCompanyId: null,
        userRoles: { some: { role: { name: 'Manager' } } },
      },
      select: { id: true },
    });
    if (!manager) throw new BadRequestException('Manager must be a staff user with the Manager role');
  }

  async assignRoles(userId: string, roleIds: string[], clientId: string, actorId: string) {
    await this.findOne(userId, clientId);
    const ownedRoles = await this.prisma.role.count({
      where: { id: { in: roleIds }, clientId },
    });
    if (ownedRoles !== roleIds.length) {
      throw new BadRequestException('One or more roles do not belong to your organization');
    }
    // Remove existing roles and reassign
    await this.prisma.userRole.deleteMany({ where: { userId } });
    await this.prisma.userRole.createMany({
      data: roleIds.map((roleId) => ({ userId, roleId, createdBy: actorId })),
    });
    return { message: 'Roles assigned' };
  }
}
