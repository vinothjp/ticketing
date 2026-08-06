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

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  // Customer contacts (customerCompanyId set) are excluded unless explicitly requested,
  // so assignee/owner pickers only ever show staff. The Users admin page opts in.
  async findAll(clientId: string, includeCustomers = false) {
    return this.prisma.user.findMany({
      where: { clientId, ...(includeCustomers ? {} : { customerCompanyId: null }) },
      select: {
        id: true,
        username: true,
        email: true,
        isActive: true,
        createdAt: true,
        userRoles: { include: { role: true } },
      },
    });
  }

  async findOne(id: string, clientId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, clientId },
      select: {
        id: true,
        username: true,
        email: true,
        isActive: true,
        createdAt: true,
        userRoles: { include: { role: true } },
      },
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

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.prisma.user.create({
      data: { username: dto.username, email: dto.email, passwordHash, clientId, createdBy: actorId, updatedBy: actorId },
    });
    return { id: user.id, username: user.username, email: user.email };
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
    if (dto.password) {
      data.passwordHash = await bcrypt.hash(dto.password, 12);
      delete data.password;
    }
    return this.prisma.user.update({ where: { id }, data });
  }

  async remove(id: string, clientId: string) {
    await this.findOne(id, clientId);
    await this.prisma.user.delete({ where: { id } });
    return { message: 'User deleted' };
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
