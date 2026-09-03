import { SheetColumn } from '../lib/spreadsheet';

/** One client as the export writes it — the row `list()` already builds. */
export interface ClientSheetRow {
  name: string;
  code?: string | null;
  contactPerson?: string | null;
  contactEmail?: string | null;
  contactNumber?: string | null;
  maxContacts: number;
  status: string;
  contractScope?: string | null;
  contactCount?: number;
  ticketCount?: number;
}

/** The two states the list screen colour-codes. */
export const CLIENT_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export const CLIENT_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
};

/**
 * The client list's columns — the export, the template and the import's header
 * matching, from one list.
 *
 * The match key is `Code`, falling back to `Client name`: a code is optional
 * (an admin types it), while the name always exists and is already unique per
 * tenant, which is what `create` enforces.
 *
 * The contract deliberately is not here. Its scope decides which support-hours
 * pool governs a client — switching it withdraws pending excess-hours requests
 * and moves what every ticket is charged against, which is why the client screen
 * guards it behind a confirmation. That is not a thing to change by pasting a
 * column, so scope is read-back only and the terms, PO and consultants stay on
 * the client's own screen.
 */
export const CLIENT_COLUMNS: SheetColumn<ClientSheetRow>[] = [
  {
    header: 'Client name', aliases: ['name', 'company', 'company name'], width: 28,
    value: (r) => r.name,
    note: 'Required. Unique within your organization, and the fallback match key for a row with no code.',
  },
  {
    header: 'Code', aliases: ['client code', 'company code'], width: 14,
    value: (r) => r.code ?? '',
    note: 'The match key. A code already in use updates that client; anything else adds one.',
  },
  {
    header: 'Contact person', aliases: ['contact'], width: 22,
    value: (r) => r.contactPerson ?? '',
    note: 'Free text — the client\'s main contact. Their login users are managed by the client\'s own admin, not here.',
  },
  {
    header: 'Contact email', aliases: ['email'], width: 26,
    value: (r) => r.contactEmail ?? '',
    note: 'Must be a valid email address.',
  },
  {
    header: 'Contact number', aliases: ['phone', 'contact phone'], width: 18,
    value: (r) => r.contactNumber ?? '',
    note: 'Free text.',
  },
  {
    header: 'Max contacts', aliases: ['contact limit'], width: 14,
    value: (r) => r.maxContacts,
    note: 'How many login users the client may create, 1 to 50. Blank keeps the current limit (5 on a new client).',
  },
  {
    header: 'Status', width: 12,
    value: (r) => CLIENT_STATUS_LABELS[r.status] ?? r.status,
    note: 'Active or Inactive. Blank keeps the current status (Active on a new client).',
  },

  // Read-back context — see the note above on why scope is not importable.
  {
    header: 'Contract scope', width: 18, exportOnly: true,
    value: (r) => (r.contractScope === 'CUSTOMER' ? 'One customer contract' : 'Per product'),
  },
  { header: 'Contacts', width: 10, exportOnly: true, value: (r) => r.contactCount ?? 0 },
  { header: 'Tickets', width: 10, exportOnly: true, value: (r) => r.ticketCount ?? 0 },
];

export const CLIENT_IMPORT_NOTES = [
  'Fill one row per client. The first row must stay as the headers.',
  'A row whose Code (or, failing that, Client name) already exists updates that client instead of adding one.',
  'On an update, a blank cell leaves the stored value alone — clear a field on the client screen instead.',
  'Contract terms, the purchase order and consultants are set on the client\'s own screen, not here — switching a client\'s contract scope moves which support-hours pool governs them.',
  'A client\'s login users are created by their own admin; importing a client never creates logins.',
];
