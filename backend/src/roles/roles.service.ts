import { Injectable, NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRoleDto } from './dto/create-role.dto';

@Injectable()
export class RolesService {
  constructor(private prisma: PrismaService) {}

  findAll(clientId: string) {
    return this.prisma.role.findMany({
      where: { clientId },
      include: { _count: { select: { userRoles: true } } },
    });
  }

  async findOne(id: string, clientId: string) {
    const role = await this.prisma.role.findFirst({ where: { id, clientId } });
    if (!role) throw new NotFoundException('Role not found');
    return role;
  }

  async create(dto: CreateRoleDto, clientId: string, actorId: string) {
    const existing = await this.prisma.role.findFirst({ where: { clientId, name: dto.name } });
    if (existing) throw new ConflictException('Role name already exists');
    return this.prisma.role.create({ data: { ...dto, clientId, createdBy: actorId, updatedBy: actorId } });
  }

  async update(id: string, dto: Partial<CreateRoleDto>, clientId: string, actorId: string) {
    const role = await this.findOne(id, clientId);
    if (role.name === 'Admin' && dto.name && dto.name !== 'Admin') {
      throw new ForbiddenException('The Admin role cannot be renamed');
    }
    return this.prisma.role.update({ where: { id }, data: { ...dto, updatedBy: actorId } });
  }

  async remove(id: string, clientId: string) {
    const role = await this.findOne(id, clientId);
    if (role.name === 'Admin') {
      throw new ForbiddenException('The Admin role cannot be deleted');
    }
    await this.prisma.role.delete({ where: { id } });
    return { message: 'Role deleted' };
  }
}
