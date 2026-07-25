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
      data: {
        name: 'SuperAdmin',
        description: 'Manages clients and licenses',
        clientId: null,
      },
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
    where: {
      userId_roleId: { userId: superAdminUser.id, roleId: superAdminRole.id },
    },
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
    create: {
      name: 'Admin',
      description: 'Full access to all forms',
      clientId: client.id,
    },
  });

  const viewerRole = await prisma.role.upsert({
    where: { clientId_name: { clientId: client.id, name: 'Viewer' } },
    update: {},
    create: {
      name: 'Viewer',
      description: 'Read-only access',
      clientId: client.id,
    },
  });

  // Create sample forms (global catalog)
  const forms = [
    'Users',
    'Roles',
    'Invoices',
    'Reports',
    'Settings',
    'TicketTemplates',
    'Tickets',
  ];
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

  // --- Ticketing master data (Acme Corp) ---
  const priorityOptions = [
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
    { value: 'urgent', label: 'Urgent' },
  ];
  const statusOptions = [
    { value: 'New', label: 'New' },
    { value: 'Open', label: 'Open' },
    { value: 'In Progress', label: 'In Progress' },
    { value: 'On Hold', label: 'On Hold' },
    { value: 'Resolved', label: 'Resolved' },
    { value: 'Closed', label: 'Closed' },
  ];
  const departmentOptions = [
    { value: 'it', label: 'IT' },
    { value: 'hr', label: 'HR' },
    { value: 'finance', label: 'Finance' },
    { value: 'operations', label: 'Operations' },
  ];
  const categoryOptions = [
    { value: 'hardware', label: 'Hardware' },
    { value: 'software', label: 'Software' },
    { value: 'network', label: 'Network' },
    { value: 'access', label: 'Access' },
  ];
  const subCategoryOptions = [
    { value: 'laptop', label: 'Laptop', parentValue: 'hardware' },
    { value: 'printer', label: 'Printer', parentValue: 'hardware' },
    { value: 'email', label: 'Email', parentValue: 'software' },
    { value: 'erp', label: 'ERP', parentValue: 'software' },
    { value: 'vpn', label: 'VPN', parentValue: 'network' },
    { value: 'wifi', label: 'Wi-Fi', parentValue: 'network' },
    { value: 'account', label: 'Account Access', parentValue: 'access' },
  ];

  const picklists: {
    listKey: string;
    value: string;
    label: string;
    parentValue?: string;
  }[] = [
    ...priorityOptions.map((o) => ({ listKey: 'priority', ...o })),
    ...statusOptions.map((o) => ({ listKey: 'ticketStatus', ...o })),
    ...departmentOptions.map((o) => ({ listKey: 'department', ...o })),
    ...categoryOptions.map((o) => ({ listKey: 'ticketCategory', ...o })),
    ...subCategoryOptions.map((o) => ({ listKey: 'subCategory', ...o })),
  ];

  for (const [i, p] of picklists.entries()) {
    await prisma.picklistOption.upsert({
      where: {
        clientId_listKey_value: {
          clientId: client.id,
          listKey: p.listKey,
          value: p.value,
        },
      },
      update: {},
      create: { clientId: client.id, sortOrder: i, ...p },
    });
  }

  const requestTypeNames = [
    'Incident',
    'Service Request',
    'Problem',
    'Change',
    'Major Incident',
    'Question',
  ];

  const defaultVisibleMandatory = ['subject', 'description', 'priority'];

  for (const [i, name] of requestTypeNames.entries()) {
    const requestType = await prisma.requestType.upsert({
      where: { clientId_name: { clientId: client.id, name } },
      update: {},
      create: { clientId: client.id, name, sortOrder: i },
    });

    const template = await prisma.template.upsert({
      where: { requestTypeId: requestType.id },
      update: {},
      create: {
        clientId: client.id,
        requestTypeId: requestType.id,
        name: `${name} Template`,
        descriptionGuidance: `Describe the ${name.toLowerCase()} in as much detail as possible so the right technician can pick it up quickly.`,
      },
    });

    for (const [fieldIndex, key] of defaultVisibleMandatory.entries()) {
      await prisma.templateField.upsert({
        where: {
          templateId_fieldKey: { templateId: template.id, fieldKey: key },
        },
        update: {},
        create: {
          templateId: template.id,
          fieldKey: key,
          visibility: 'VISIBLE',
          requirement: 'MANDATORY',
          sortOrder: fieldIndex,
        },
      });
    }
  }

  console.log('Seed complete!');
  console.log(
    'Super Admin login: username=superadmin, password=SuperAdmin@123',
  );
  console.log(
    'Client (Acme Corp) Admin login: username=admin, password=Admin@123',
  );
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
