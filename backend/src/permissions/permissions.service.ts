import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertPermissionDto } from './dto/upsert-permission.dto';
import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_ACTIONS,
  PermissionAction,
} from './default-permissions';

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

  /**
   * Seed the out-of-the-box permissions for this tenant's roles.
   *
   * Idempotent and additive: it writes only the `[role, form]` pairs that have
   * no row at all, so an admin's own edits — including a box they deliberately
   * unticked — are never overwritten, and a role name outside
   * `DEFAULT_ROLE_PERMISSIONS` is left untouched.
   */
  private async ensureDefaults(clientId: string, actorId?: string) {
    const roles = await this.prisma.role.findMany({ where: { clientId } });
    const named = roles.filter((r) => DEFAULT_ROLE_PERMISSIONS[r.name]);
    if (!named.length) return;

    const forms = await this.prisma.appForm.findMany();
    if (!forms.length) return;

    const existing = await this.prisma.formPermission.findMany({
      where: { roleId: { in: named.map((r) => r.id) } },
      select: { roleId: true, formId: true },
    });
    const seen = new Set(existing.map((p) => `${p.roleId}:${p.formId}`));

    const rows: any[] = [];
    for (const role of named) {
      const defaults = DEFAULT_ROLE_PERMISSIONS[role.name];
      for (const form of forms) {
        const granted = defaults[form.name];
        // A form the table says nothing about is not a denial — skip it, so a
        // form added later can be granted by hand without being re-zeroed.
        if (!granted) continue;
        if (seen.has(`${role.id}:${form.id}`)) continue;
        const row: Record<string, unknown> = {
          roleId: role.id,
          formId: form.id,
          createdBy: actorId ?? null,
          updatedBy: actorId ?? null,
        };
        for (const action of PERMISSION_ACTIONS) {
          row[action] = granted.includes(action as PermissionAction);
        }
        rows.push(row);
      }
    }

    if (rows.length) {
      await this.prisma.formPermission.createMany({ data: rows, skipDuplicates: true });
    }
  }

  async getMatrix(clientId: string) {
    await this.ensureDefaults(clientId);

    const roles = await this.prisma.role.findMany({ where: { clientId }, orderBy: { name: 'asc' } });
    const forms = await this.prisma.appForm.findMany({ orderBy: { displayName: 'asc' } });
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
