import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTeamMemberDto, UpdateTeamMemberDto } from './dto/customer-team.dto';

type Actor = { id: string; clientId: string; customerCompanyId: string };

@Injectable()
export class CustomerTeamService {
  constructor(private prisma: PrismaService) {}

  private async roleId(clientId: string, name: 'Customer' | 'CustomerAdmin') {
    const role = await this.prisma.role.findFirst({ where: { clientId, name } });
    if (!role) throw new NotFoundException(`Role ${name} not found`);
    return role.id;
  }

  /** True if the user belongs to the actor's company (so we never touch others). */
  private async memberOfMyCompany(userId: string, companyId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, customerCompanyId: companyId },
      include: { userRoles: { include: { role: true } } },
    });
    if (!user) throw new NotFoundException('Team member not found');
    return user;
  }

  private roleLabel(roleNames: string[]) {
    return roleNames.includes('CustomerAdmin') ? 'admin' : 'employee';
  }

  async list(actor: Actor) {
    const users = await this.prisma.user.findMany({
      where: { customerCompanyId: actor.customerCompanyId },
      include: { userRoles: { include: { role: true } } },
      orderBy: { username: 'asc' },
    });
    return users.map((u) => ({
      id: u.id,
      username: u.username,
      email: u.email,
      isActive: u.isActive,
      role: this.roleLabel(u.userRoles.map((ur) => ur.role.name)),
      isSelf: u.id === actor.id,
      createdAt: u.createdAt,
    }));
  }

  async create(dto: CreateTeamMemberDto, actor: Actor) {
    const company = await this.prisma.customerCompany.findFirst({
      where: { id: actor.customerCompanyId, clientId: actor.clientId },
    });
    if (!company) throw new NotFoundException('Customer company not found');

    const count = await this.prisma.user.count({
      where: { customerCompanyId: actor.customerCompanyId },
    });
    if (count >= company.maxContacts) {
      throw new BadRequestException(
        `Your company has reached its limit of ${company.maxContacts} users`,
      );
    }

    const clash = await this.prisma.user.findFirst({
      where: { OR: [{ username: dto.username }, { email: dto.email }] },
    });
    if (clash) throw new ConflictException('Username or email already exists');

    const roleName = dto.role === 'admin' ? 'CustomerAdmin' : 'Customer';
    const roleId = await this.roleId(actor.clientId, roleName);
    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.prisma.user.create({
      data: {
        username: dto.username,
        email: dto.email,
        passwordHash,
        clientId: actor.clientId,
        customerCompanyId: actor.customerCompanyId,
        createdBy: actor.id,
        updatedBy: actor.id,
        userRoles: { create: [{ roleId, createdBy: actor.id }] },
      },
    });
    return { id: user.id, username: user.username, email: user.email, role: dto.role ?? 'employee' };
  }

  async update(userId: string, dto: UpdateTeamMemberDto, actor: Actor) {
    const target = await this.memberOfMyCompany(userId, actor.customerCompanyId);
    const isSelf = target.id === actor.id;

    // Guard against self-lockout: an admin can't deactivate or demote themselves.
    if (isSelf && dto.isActive === false) {
      throw new BadRequestException('You cannot deactivate your own account');
    }
    if (isSelf && dto.role === 'employee') {
      throw new BadRequestException('You cannot remove your own admin role');
    }

    if (dto.role) {
      const desired = dto.role === 'admin' ? 'CustomerAdmin' : 'Customer';
      const [customerId, adminId] = await Promise.all([
        this.roleId(actor.clientId, 'Customer'),
        this.roleId(actor.clientId, 'CustomerAdmin'),
      ]);
      const keepId = desired === 'CustomerAdmin' ? adminId : customerId;
      // Replace their customer-side role assignment with the desired one.
      await this.prisma.userRole.deleteMany({
        where: { userId, roleId: { in: [customerId, adminId] } },
      });
      await this.prisma.userRole.create({ data: { userId, roleId: keepId, createdBy: actor.id } });
    }

    if (dto.isActive !== undefined) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { isActive: dto.isActive, updatedBy: actor.id },
      });
    }
    return { message: 'Team member updated' };
  }

  async remove(userId: string, actor: Actor) {
    const target = await this.memberOfMyCompany(userId, actor.customerCompanyId);
    if (target.id === actor.id) {
      throw new BadRequestException('You cannot remove your own account');
    }
    // Deactivate rather than hard-delete so their ticket history stays intact.
    await this.prisma.user.update({
      where: { id: userId },
      data: { isActive: false, updatedBy: actor.id },
    });
    return { message: 'Team member deactivated' };
  }
}
