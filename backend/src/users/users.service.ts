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
import { OPEN_ALLOCATION_STATUSES } from '../assets/allocation-status';
import { EMPLOYEE_COLUMNS, EMPLOYEE_IMPORT_NOTES } from './employee-sheet';
import type { EmployeeSheetRow } from './employee-sheet';
import {
  exportSheet, importTemplate, readSheet, rowReader, asText, errorText,
} from '../lib/spreadsheet';
import type { ImportResult } from '../lib/spreadsheet';

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


  // ---- Employee Master import / export -------------------------------------

  /**
   * Every internal staff member as a spreadsheet, in the columns the importer
   * accepts — so an export can be edited and posted straight back. Customer
   * contacts are never employees, so they are out of it by the same rule
   * `findAll` applies.
   */
  async exportEmployees(clientId: string) {
    const staff = await this.prisma.user.findMany({
      where: { clientId, customerCompanyId: null },
      orderBy: [{ employeeId: 'asc' }, { username: 'asc' }],
      select: {
        id: true, employeeId: true, name: true, username: true, email: true,
        department: true, designation: true, phone: true, isActive: true,
        manager: { select: { name: true, username: true } },
      },
    });

    // One grouped count rather than a query per person — the Assets held column
    // reads exactly what the list screen's Assets column does.
    const held = await this.prisma.assetAllocation.groupBy({
      by: ['employeeUserId'],
      where: { clientId, status: { in: OPEN_ALLOCATION_STATUSES } },
      _count: { _all: true },
    });
    const counts = new Map(held.map((h) => [h.employeeUserId, h._count._all]));

    const rows: EmployeeSheetRow[] = staff.map((u) => ({ ...u, assetsHeld: counts.get(u.id) ?? 0 }));
    return exportSheet('Employees', EMPLOYEE_COLUMNS, rows);
  }

  /** The blank template: the same columns, minus the ones an import cannot set. */
  employeeImportTemplate() {
    return importTemplate('Employees', EMPLOYEE_COLUMNS, EMPLOYEE_IMPORT_NOTES);
  }

  /**
   * Bulk add/update from a spreadsheet, matched on employee ID and falling back
   * to username.
   *
   * Every row goes through the ordinary `create` / `update`, so the licence seat
   * limit, the unique employee ID, the username/email conflict check and the
   * Manager-role rule all apply exactly as they do on the form — an import is a
   * fast way to type, not a second way in. Rows run **serially**: the seat limit
   * and the uniqueness checks count what earlier rows have already written, which
   * a `Promise.all` would race past.
   */
  async importEmployees(clientId: string, actorId: string, file?: Express.Multer.File): Promise<ImportResult> {
    const records = readSheet(file);
    const result: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] };

    const column = (header: string) => EMPLOYEE_COLUMNS.find((c) => c.header === header)!;
    const COLS = {
      employeeId: column('Employee ID'),
      name: column('Employee name'),
      username: column('Username'),
      email: column('Email'),
      password: column('Password'),
      department: column('Department'),
      designation: column('Designation'),
      phone: column('Phone'),
      manager: column('Manager'),
      status: column('Status'),
    };

    // The manager candidates, once — a manager is a staff user carrying the
    // Manager role, and a sheet may name them by code, full name or login.
    const managers = await this.prisma.user.findMany({
      where: { clientId, customerCompanyId: null, userRoles: { some: { role: { name: 'Manager' } } } },
      select: { id: true, employeeId: true, name: true, username: true },
    });
    const managerBy = new Map<string, string>();
    for (const m of managers) {
      for (const key of [m.employeeId, m.name, m.username]) {
        if (key) managerBy.set(key.trim().toLowerCase(), m.id);
      }
    }

    for (const [i, record] of records.entries()) {
      const line = i + 2; // the header is row 1, so a sheet row is its index + 2
      try {
        // A trailing blank row is the normal shape of a hand-edited sheet, not an error.
        if (!Object.values(record).some((v) => asText(v))) continue;

        const read = rowReader(record);
        const cell = (c: keyof typeof COLS) => asText(read(COLS[c]));
        const employeeId = cell('employeeId');
        const username = cell('username');

        const byCode = employeeId
          ? await this.prisma.user.findFirst({
              where: { clientId, customerCompanyId: null, employeeId },
              select: { id: true },
            })
          : null;
        const matched =
          byCode ??
          (username
            ? await this.prisma.user.findFirst({
                where: { clientId, customerCompanyId: null, username },
                select: { id: true },
              })
            : null);

        // A blank cell on an update means "leave it alone", so only the columns
        // the sheet actually carries are sent — the DTO's undefined-skips-the-field
        // rule does the rest.
        const fields: Record<string, unknown> = {};
        for (const key of ['name', 'department', 'designation', 'phone'] as const) {
          const v = cell(key);
          if (v) fields[key] = v;
        }

        const managerCell = cell('manager');
        if (managerCell) {
          // "none" is the one way a sheet can *clear* a value: a manager is a
          // reporting line an employee can genuinely leave, unlike a blank cell,
          // which means the row simply says nothing about it.
          if (['none', 'no manager', '-'].includes(managerCell.toLowerCase())) {
            fields.managerId = null;
          } else {
            const managerId = managerBy.get(managerCell.toLowerCase());
            if (!managerId) {
              throw new BadRequestException(
                `Manager: no staff user with the Manager role matches "${managerCell}"`,
              );
            }
            fields.managerId = managerId;
          }
        }

        const status = cell('status');
        if (status) {
          const on = ['active', 'yes', 'true', 'y', '1'];
          const off = ['inactive', 'no', 'false', 'n', '0'];
          const want = status.toLowerCase();
          if (!on.includes(want) && !off.includes(want)) {
            throw new BadRequestException(`Status: "${status}" is not Active or Inactive`);
          }
          fields.isActive = on.includes(want);
        }

        const email = cell('email');
        const password = cell('password');

        if (matched) {
          // Username is the fallback match key, so an import never rewrites it —
          // renaming a login is an edit on the Users screen.
          if (employeeId) fields.employeeId = employeeId;
          if (email) fields.email = email;
          if (password) fields.password = password;
          await this.update(matched.id, fields as UpdateUserDto, clientId, actorId);
          result.updated += 1;
        } else {
          if (!username) throw new BadRequestException('Username is required to add a new employee');
          if (!email) throw new BadRequestException('Email is required to add a new employee');
          if (password.length < 8) {
            throw new BadRequestException('Password is required to add a new employee, at least 8 characters');
          }
          // isActive is not a create field — a new employee starts active, so a
          // row asking for Inactive is deactivated straight after.
          const { isActive, ...creatable } = fields;
          const created = await this.create(
            { ...creatable, username, email, password, employeeId: employeeId || undefined } as CreateUserDto,
            clientId,
            actorId,
          );
          if (isActive === false) await this.update(created.id, { isActive: false }, clientId, actorId);
          result.created += 1;
        }
      } catch (e) {
        result.skipped += 1;
        result.errors.push({ row: line, message: errorText(e) });
      }
    }

    return result;
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
