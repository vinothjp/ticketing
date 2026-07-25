import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as bcrypt from 'bcryptjs';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  // --- Platform level: Super Admin (no client) ---
  // Role.clientId is nullable, and Postgres doesn't enforce uniqueness across
  // NULLs, so the (clientId, name) unique constraint can't drive an upsert
  // here — find-or-create instead to stay idempotent.
  let superAdminRole = await prisma.role.findFirst({
    where: { clientId: null, name: 'SuperAdmin' },
  });
  if (!superAdminRole) {
    superAdminRole = await prisma.role.create({
      data: { name: 'SuperAdmin', description: 'Manages clients and licenses', clientId: null },
    });
  }

  const superAdminPasswordHash = await bcrypt.hash('SuperAdmin@123', 12);
  const superAdminUser = await prisma.user.upsert({
    where: { email: 'superadmin@rbac.com' },
    update: {},
    create: {
      username: 'superadmin',
      email: 'superadmin@rbac.com',
      passwordHash: superAdminPasswordHash,
      clientId: null,
    },
  });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: superAdminUser.id, roleId: superAdminRole.id } },
    update: {},
    create: { userId: superAdminUser.id, roleId: superAdminRole.id },
  });

  // --- Sample client: Acme Corp ---
  const client = await prisma.client.upsert({
    where: { code: 'ACME' },
    update: {},
    create: {
      name: 'Acme Corp',
      code: 'ACME',
      contactEmail: 'ops@acme.example',
      status: 'ACTIVE',
    },
  });

  await prisma.license.upsert({
    where: { clientId: client.id },
    update: {},
    create: {
      clientId: client.id,
      plan: 'Enterprise',
      maxUsers: 25,
      startDate: new Date(),
      expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      status: 'ACTIVE',
    },
  });

  // Create admin role (scoped to Acme Corp)
  const adminRole = await prisma.role.upsert({
    where: { clientId_name: { clientId: client.id, name: 'Admin' } },
    update: {},
    create: { name: 'Admin', description: 'Full access to all forms', clientId: client.id },
  });

  const viewerRole = await prisma.role.upsert({
    where: { clientId_name: { clientId: client.id, name: 'Viewer' } },
    update: {},
    create: { name: 'Viewer', description: 'Read-only access', clientId: client.id },
  });

  // Create sample forms (global catalog)
  const forms = ['Users', 'Roles', 'Invoices', 'Reports', 'Settings'];
  const createdForms = [];
  for (const f of forms) {
    const form = await prisma.appForm.upsert({
      where: { name: f },
      update: {},
      create: { name: f, displayName: f, description: `${f} management form` },
    });
    createdForms.push(form);
  }

  // Admin gets full permissions on all forms
  for (const form of createdForms) {
    await prisma.formPermission.upsert({
      where: { roleId_formId: { roleId: adminRole.id, formId: form.id } },
      update: {},
      create: {
        roleId: adminRole.id,
        formId: form.id,
        canCreate: true,
        canUpdate: true,
        canView: true,
        canDelete: true,
        canExport: true,
        canImport: true,
      },
    });
  }

  // Viewer gets view only
  for (const form of createdForms) {
    await prisma.formPermission.upsert({
      where: { roleId_formId: { roleId: viewerRole.id, formId: form.id } },
      update: {},
      create: {
        roleId: viewerRole.id,
        formId: form.id,
        canCreate: false,
        canUpdate: false,
        canView: true,
        canDelete: false,
        canExport: false,
        canImport: false,
      },
    });
  }

  // Create tenant admin user
  const passwordHash = await bcrypt.hash('Admin@123', 12);
  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@rbac.com' },
    update: {},
    create: {
      username: 'admin',
      email: 'admin@rbac.com',
      passwordHash,
      clientId: client.id,
    },
  });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: adminUser.id, roleId: adminRole.id } },
    update: {},
    create: { userId: adminUser.id, roleId: adminRole.id },
  });

  console.log('Seed complete!');
  console.log('Super Admin login: username=superadmin, password=SuperAdmin@123');
  console.log('Client (Acme Corp) Admin login: username=admin, password=Admin@123');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
