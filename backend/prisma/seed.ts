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

  // --- Ticketing master data (Acme Corp) — values per the Support Ticket spec ---
  const priorityOptions = [
    { value: 'critical', label: 'Critical' },
    { value: 'high', label: 'High' },
    { value: 'medium', label: 'Medium' },
    { value: 'low', label: 'Low' },
  ];
  const statusOptions = [
    { value: 'Open', label: 'Open' },
    { value: 'On Hold', label: 'On Hold' },
    { value: 'In Progress', label: 'In Progress' },
    { value: 'Awaiting Vendor Update', label: 'Awaiting Vendor Update' },
    { value: 'Awaiting End-user Response', label: 'Awaiting End-user Response' },
    { value: 'Assigned', label: 'Assigned' },
    { value: 'Approval Pending', label: 'Approval Pending' },
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
    { value: 'OS', label: 'OS' },
    { value: 'Networking', label: 'Networking' },
    { value: 'Software', label: 'Software' },
    { value: 'Downtime', label: 'Downtime' },
    { value: 'Security', label: 'Security' },
  ];
  const subCategoryOptions = [
    { value: 'Windows', label: 'Windows', parentValue: 'OS' },
    { value: 'Linux', label: 'Linux', parentValue: 'OS' },
    { value: 'LAN / WAN', label: 'LAN / WAN', parentValue: 'Networking' },
    { value: 'VPN', label: 'VPN', parentValue: 'Networking' },
    { value: 'Email', label: 'Email', parentValue: 'Software' },
    { value: 'ERP', label: 'ERP', parentValue: 'Software' },
    { value: 'Server', label: 'Server', parentValue: 'Downtime' },
    { value: 'Access', label: 'Access', parentValue: 'Security' },
    { value: 'Malware', label: 'Malware', parentValue: 'Security' },
  ];
  const requestTypeOptions = [
    { value: 'Service Request', label: 'Service Request' },
    { value: 'Incident', label: 'Incident' },
    { value: 'Issue', label: 'Issue' },
    { value: 'Preventive Maintenance', label: 'Preventive Maintenance' },
    { value: 'Doubt Clarification', label: 'Doubt Clarification' },
  ];
  const resolutionCodeOptions = [
    { value: 'Fixed', label: 'Fixed' },
    { value: 'Workaround', label: 'Workaround Provided' },
    { value: 'Not Reproducible', label: 'Not Reproducible' },
    { value: 'Duplicate', label: 'Duplicate' },
    { value: 'No Action Needed', label: 'No Action Needed' },
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
    ...requestTypeOptions.map((o) => ({ listKey: 'requestType', ...o })),
    ...resolutionCodeOptions.map((o) => ({ listKey: 'resolutionCode', ...o })),
  ];

  // Replace the picklist master so values match the spec exactly (dev data).
  await prisma.picklistOption.deleteMany({ where: { clientId: client.id } });
  await prisma.picklistOption.createMany({
    data: picklists.map((p, i) => ({ clientId: client.id, sortOrder: i, ...p })),
  });

  // --- SLA master (Priority -> resolution hours) ---
  const slaPolicies = [
    { priority: 'critical', resolutionHours: 4, responseHours: 1 },
    { priority: 'high', resolutionHours: 8, responseHours: 2 },
    { priority: 'medium', resolutionHours: 24, responseHours: 4 },
    { priority: 'low', resolutionHours: 72, responseHours: 8 },
  ];
  for (const s of slaPolicies) {
    await prisma.slaPolicy.upsert({
      where: { clientId_priority: { clientId: client.id, priority: s.priority } },
      update: { resolutionHours: s.resolutionHours, responseHours: s.responseHours },
      create: { clientId: client.id, ...s },
    });
  }

  // --- Ticket templates (Acme Corp) ---
  type FieldSpec = {
    fieldKey?: string;
    isCustom?: boolean;
    label?: string;
    dataType?: string;
    group?: string;
    placeholder?: string;
    options?: { value: string; label: string }[];
    requirement?: 'MANDATORY' | 'OPTIONAL';
  };
  type TemplateSpec = {
    name: string;
    category: string;
    icon: string;
    color: string;
    descriptionGuidance?: string;
    fields: FieldSpec[];
  };

  const optSlug = (label: string) =>
    label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const opts = (...labels: string[]) =>
    labels.map((label) => ({ value: optSlug(label), label }));
  const sys = (fieldKey: string, requirement: 'MANDATORY' | 'OPTIONAL' = 'OPTIONAL'): FieldSpec => ({
    fieldKey,
    isCustom: false,
    requirement,
  });
  const cf = (
    label: string,
    dataType: string,
    extra: Partial<FieldSpec> = {},
  ): FieldSpec => ({
    isCustom: true,
    label,
    dataType,
    group: 'ticket_detail',
    requirement: 'OPTIONAL',
    ...extra,
  });

  const templateSpecs: TemplateSpec[] = [
    {
      name: 'IT Incident',
      category: 'Incident',
      icon: 'alert-triangle',
      color: '#e11d48',
      descriptionGuidance:
        'Describe the issue, what you were doing when it happened, and any error messages you saw.',
      fields: [
        sys('subject', 'MANDATORY'),
        sys('requestType', 'MANDATORY'),
        sys('department'),
        sys('ticketCategory'),
        sys('subCategory'),
        sys('priority', 'MANDATORY'),
        cf('Impact', 'SELECT', { group: 'ticket_info', requirement: 'MANDATORY', options: opts('High', 'Medium', 'Low') }),
        cf('Urgency', 'SELECT', { group: 'ticket_info', options: opts('High', 'Medium', 'Low') }),
        sys('description', 'MANDATORY'),
        sys('attachments'),
        sys('customerConfirmation'),
        sys('rootCauseCategory'),
        sys('rootCauseDescription'),
        sys('correctionAction'),
        sys('preventionAction'),
        sys('lessonsLearned'),
      ],
    },
    {
      name: 'IT Service Request',
      category: 'Service Request',
      icon: 'settings',
      color: '#2563eb',
      descriptionGuidance: 'Tell us what you need and why.',
      fields: [
        sys('subject', 'MANDATORY'),
        sys('department'),
        cf('Request category', 'SELECT', { group: 'ticket_info', requirement: 'MANDATORY', options: opts('Hardware', 'Software', 'Access') }),
        cf('Item needed', 'TEXT', { placeholder: 'e.g. Dell 27" monitor' }),
        cf('Justification', 'TEXTAREA', { requirement: 'MANDATORY' }),
        cf('Needed by', 'DATE', { group: 'ticket_info' }),
        sys('priority'),
        sys('description'),
      ],
    },
    {
      name: 'Bug Report',
      category: 'Problem',
      icon: 'bug',
      color: '#d97706',
      descriptionGuidance: 'A clear, reproducible bug report helps us fix it faster.',
      fields: [
        sys('subject', 'MANDATORY'),
        cf('Steps to reproduce', 'TEXTAREA', { requirement: 'MANDATORY', placeholder: '1. …\n2. …\n3. …' }),
        cf('Expected result', 'TEXTAREA'),
        cf('Actual result', 'TEXTAREA'),
        cf('Environment', 'SELECT', { group: 'ticket_info', requirement: 'MANDATORY', options: opts('Production', 'Staging', 'Development') }),
        cf('Severity', 'SELECT', { group: 'ticket_info', requirement: 'MANDATORY', options: opts('Critical', 'Major', 'Minor', 'Trivial') }),
        sys('attachments'),
      ],
    },
    {
      name: 'Change Request',
      category: 'Change',
      icon: 'refresh-cw',
      color: '#7c3aed',
      descriptionGuidance: 'Describe the change, its purpose, and its expected effect.',
      fields: [
        sys('subject', 'MANDATORY'),
        sys('description', 'MANDATORY'),
        cf('Change type', 'RADIO', { group: 'ticket_info', requirement: 'MANDATORY', options: opts('Standard', 'Normal', 'Emergency') }),
        cf('Risk level', 'SELECT', { group: 'ticket_info', requirement: 'MANDATORY', options: opts('High', 'Medium', 'Low') }),
        cf('Rollback plan', 'TEXTAREA', { requirement: 'MANDATORY' }),
        cf('Scheduled window', 'DATETIME', { group: 'ticket_info' }),
        sys('priority'),
      ],
    },
    {
      name: 'Employee Onboarding',
      category: 'HR',
      icon: 'user-plus',
      color: '#0d9488',
      descriptionGuidance: 'Everything needed to get a new hire set up on day one.',
      fields: [
        cf('Employee name', 'TEXT', { group: 'ticket_info', requirement: 'MANDATORY' }),
        cf('Start date', 'DATE', { group: 'ticket_info', requirement: 'MANDATORY' }),
        sys('department'),
        cf('Role / title', 'TEXT', { group: 'ticket_info' }),
        cf('Reporting manager', 'TEXT', { group: 'ticket_info' }),
        cf('Equipment needed', 'MULTI_SELECT', { options: opts('Laptop', 'Monitor', 'Phone', 'Headset', 'Docking station') }),
        cf('Access needed', 'TEXTAREA', { placeholder: 'Email, VPN, ERP, shared drives…' }),
        sys('description'),
      ],
    },
    {
      name: 'Access / Password Reset',
      category: 'Access',
      icon: 'lock',
      color: '#4f46e5',
      descriptionGuidance: 'Request access to a system or a password reset.',
      fields: [
        cf('User', 'TEXT', { group: 'ticket_info', requirement: 'MANDATORY' }),
        cf('System / application', 'SELECT', { group: 'ticket_info', requirement: 'MANDATORY', options: opts('Email', 'VPN', 'ERP', 'CRM', 'Active Directory') }),
        cf('Access level', 'SELECT', { group: 'ticket_info', options: opts('Read', 'Write', 'Admin') }),
        cf('Business justification', 'TEXTAREA', { requirement: 'MANDATORY' }),
        cf('Manager approval obtained', 'BOOLEAN'),
        sys('priority'),
      ],
    },
    {
      name: 'General Inquiry',
      category: 'General',
      icon: 'message-circle',
      color: '#64748b',
      descriptionGuidance: 'Ask us anything — we’ll route it to the right team.',
      fields: [
        sys('subject', 'MANDATORY'),
        sys('ticketCategory'),
        sys('priority'),
        sys('description', 'MANDATORY'),
      ],
    },
  ];

  for (const [i, spec] of templateSpecs.entries()) {
    const template = await prisma.template.upsert({
      where: { clientId_name: { clientId: client.id, name: spec.name } },
      update: {
        category: spec.category,
        icon: spec.icon,
        color: spec.color,
        descriptionGuidance: spec.descriptionGuidance,
        sortOrder: i,
      },
      create: {
        clientId: client.id,
        name: spec.name,
        category: spec.category,
        icon: spec.icon,
        color: spec.color,
        descriptionGuidance: spec.descriptionGuidance,
        sortOrder: i,
      },
    });

    // Rebuild the field set from the spec (idempotent).
    await prisma.templateField.deleteMany({ where: { templateId: template.id } });
    await prisma.templateField.createMany({
      data: spec.fields.map((f, idx) => ({
        templateId: template.id,
        fieldKey: f.isCustom
          ? `cf_${optSlug(f.label!)}`
          : f.fieldKey!,
        isCustom: !!f.isCustom,
        label: f.isCustom ? f.label : null,
        dataType: f.isCustom ? f.dataType : null,
        group: f.isCustom ? (f.group ?? 'ticket_detail') : null,
        placeholder: f.isCustom ? (f.placeholder ?? null) : null,
        options: f.isCustom && f.options ? f.options : undefined,
        visibility: 'VISIBLE' as const,
        requirement: (f.requirement ?? 'OPTIONAL') as 'MANDATORY' | 'OPTIONAL',
        sortOrder: idx,
      })),
    });
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
