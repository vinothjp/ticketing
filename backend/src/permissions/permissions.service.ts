import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertPermissionDto } from './dto/upsert-permission.dto';

@Injectable()
export class PermissionsService {
  constructor(private prisma: PrismaService) {}

  private async assertRoleOwnedByClient(roleId: string, clientId: string) {
    const role = await this.prisma.role.findFirst({ where: { id: roleId, clientId } });
    if (!role) throw new NotFoundException('Role not found');
  }

  async getByRole(roleId: string, clientId: string) {
    await this.assertRoleOwnedByClient(roleId, clientId);
    return this.prisma.formPermission.findMany({
      where: { roleId },
      include: { form: true },
    });
  }

  async upsert(dto: UpsertPermissionDto, clientId: string, actorId: string) {
    await this.assertRoleOwnedByClient(dto.roleId, clientId);
    return this.prisma.formPermission.upsert({
      where: { roleId_formId: { roleId: dto.roleId, formId: dto.formId } },
      update: {
        canCreate: dto.canCreate,
        canUpdate: dto.canUpdate,
        canView: dto.canView,
        canDelete: dto.canDelete,
        canExport: dto.canExport,
        canImport: dto.canImport,
        updatedBy: actorId,
      },
      create: {
        roleId: dto.roleId,
        formId: dto.formId,
        canCreate: dto.canCreate ?? false,
        canUpdate: dto.canUpdate ?? false,
        canView: dto.canView ?? false,
        canDelete: dto.canDelete ?? false,
        canExport: dto.canExport ?? false,
        canImport: dto.canImport ?? false,
        createdBy: actorId,
        updatedBy: actorId,
      },
    });
  }

  async getMatrix(clientId: string) {
    const roles = await this.prisma.role.findMany({ where: { clientId } });
    const forms = await this.prisma.appForm.findMany();
    const permissions = await this.prisma.formPermission.findMany({
      where: { role: { clientId } },
    });

    return { roles, forms, permissions };
  }

  async remove(roleId: string, formId: string, clientId: string) {
    await this.assertRoleOwnedByClient(roleId, clientId);
    const perm = await this.prisma.formPermission.findUnique({
      where: { roleId_formId: { roleId, formId } },
    });
    if (!perm) throw new NotFoundException('Permission not found');
    await this.prisma.formPermission.delete({
      where: { roleId_formId: { roleId, formId } },
    });
    return { message: 'Permission removed' };
  }
}
