/**
 * The permissions a role is *born* with, per form.
 *
 * Keyed by `Role.name` → `AppForm.name`. `ensureDefaults` seeds these lazily per
 * tenant and only fills in rows that are **missing** — an admin who has since
 * unticked a box on the Roles screen is never overwritten, and a role or form
 * outside this table is left entirely alone.
 *
 * `SuperAdmin` is deliberately absent: it is the cross-tenant platform role
 * (`clientId = null`), so it never appears in a tenant's permission matrix.
 */
export type PermissionAction =
  | 'canView'
  | 'canCreate'
  | 'canUpdate'
  | 'canDelete'
  | 'canExport'
  | 'canImport';

export const PERMISSION_ACTIONS: PermissionAction[] = [
  'canCreate', 'canUpdate', 'canView', 'canDelete', 'canExport', 'canImport',
];

const ALL: PermissionAction[] = [...PERMISSION_ACTIONS];
const READ: PermissionAction[] = ['canView'];
const READ_EXPORT: PermissionAction[] = ['canView', 'canExport'];
const WORK: PermissionAction[] = ['canView', 'canCreate', 'canUpdate', 'canExport'];

export const DEFAULT_ROLE_PERMISSIONS: Record<string, Record<string, PermissionAction[]>> = {
  // Tenant admin — everything, on every form.
  Admin: {
    Users: ALL, Roles: ALL, Invoices: ALL, Reports: ALL,
    Settings: ALL, TicketTemplates: ALL, Tickets: ALL,
  },

  // Internal lead: runs the desk and the people on it, but does not re-cut the
  // role model or the tenant's own settings.
  Manager: {
    Users: [...WORK, 'canDelete'],
    Roles: READ,
    Invoices: READ_EXPORT,
    Reports: READ_EXPORT,
    Settings: READ,
    TicketTemplates: [...WORK, 'canDelete'],
    Tickets: ALL,
  },

  // Internal agent/technician — works tickets, reads the rest.
  Viewer: {
    Users: READ,
    Roles: [],
    Invoices: [],
    Reports: READ_EXPORT,
    Settings: [],
    TicketTemplates: READ,
    Tickets: WORK,
  },

  // A customer company's own admin: manages their contacts and their tickets,
  // sees their invoices. Nothing of the provider's.
  CustomerAdmin: {
    Users: [...WORK, 'canDelete'],
    Roles: [],
    Invoices: READ_EXPORT,
    Reports: READ,
    Settings: [],
    TicketTemplates: READ,
    Tickets: WORK,
  },

  // A customer contact — raises and follows their own tickets.
  Customer: {
    Users: [],
    Roles: [],
    Invoices: READ,
    Reports: [],
    Settings: [],
    TicketTemplates: [],
    Tickets: ['canView', 'canCreate'],
  },
};
