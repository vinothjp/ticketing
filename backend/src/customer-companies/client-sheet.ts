import { SheetColumn, dateCell } from '../lib/spreadsheet';
import { CLIENT_TYPE_LABELS, type ClientType } from './client-type';

/** One client as the export writes it — the row `list()` already builds. */
export interface ClientSheetRow {
  name: string;
  code?: string | null;
  contactPerson?: string | null;
  contactEmail?: string | null;
  contactNumber?: string | null;
  maxContacts: number;
  status: string;
  clientType?: string | null;
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
 * pool governs a client — switching it blanks the terms being entered and
 * moves what every ticket is charged against, which is why the client screen
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

  // Importable for a NEW client only. An existing client's type changes on its
  // own screen (PUT :id/client-type, with its guards), so the importer refuses a
  // row that would change it rather than quietly ignoring the cell.
  {
    header: 'Client type', aliases: ['AMC or Implementation'], width: 16,
    value: (r) => CLIENT_TYPE_LABELS[(r.clientType ?? 'AMC') as ClientType] ?? 'AMC',
    note: 'AMC or Implementation, for a new client — blank adds it as AMC. An existing client\'s type is changed on its own screen; a row that would change it is refused.',
  },

  // Read-back context — see the note above on why scope is not importable.
  {
    header: 'Contract scope', width: 22, exportOnly: true,
    value: (r) => (r.clientType === 'IMPLEMENTATION' ? '—' : r.contractScope === 'CUSTOMER' ? 'One customer contract' : 'Per product'),
  },
  { header: 'Contacts', width: 10, exportOnly: true, value: (r) => r.contactCount ?? 0 },
  { header: 'Tickets', width: 10, exportOnly: true, value: (r) => r.ticketCount ?? 0 },
];

export const CLIENT_IMPORT_NOTES = [
  'Fill one row per client. The first row must stay as the headers.',
  'A row whose Code (or, failing that, Client name) already exists updates that client instead of adding one.',
  'On an update, a blank cell leaves the stored value alone — clear a field on the client screen instead.',
  'Client type (AMC or Implementation) is set when a client is added; blank adds it as AMC. To change an existing client\'s type, use its own screen.',
  'Contract terms, the purchase order and consultants are set on the client\'s own screen, not here — switching a client\'s contract scope moves which support-hours pool governs them.',
  'A client\'s login users are created by their own admin; importing a client never creates logins.',
];

// ---- read-back sheets (export only) -------------------------------------------
//
// The client export carries two more sheets after Clients. They are never read
// back: `readSheet` reads the first sheet only, which is why Clients stays first
// and keeps the export → import round trip a no-op.

/** One contract: a per-product AMC client has one per product, a shared contract one in all. */
export interface ContractSheetRow {
  clientName: string;
  product: string;
  coverage: string | null;        // 'WARRANTY' | 'AMC'
  hoursUnlimited: boolean;
  hours: number | null;
  hoursPeriod: string;             // 'FULL_AMC' | 'MONTHLY'
  visits: number | null;
  start: Date | null;
  end: Date | null;
  amount: number | null;
}

/** No dates = terms never entered (a product just assigned, or a scope switch that blanked them). */
const noTerms = (r: ContractSheetRow) => !r.start && !r.end;

/**
 * "Unlimited", "120 h / month", "40 h for the term" — or blank when none was set.
 * Blank, too, for a contract with no terms yet: its stored default reads as
 * Unlimited, which nobody agreed.
 */
const supportHoursText = (r: ContractSheetRow) =>
  noTerms(r) ? ''
    : r.hoursUnlimited ? 'Unlimited'
    : r.hours == null ? ''
      : r.hoursPeriod === 'MONTHLY' ? `${r.hours} h / month` : `${r.hours} h for the term`;

export const CONTRACT_COLUMNS: SheetColumn<ContractSheetRow>[] = [
  { header: 'Client name', width: 28, value: (r) => r.clientName },
  { header: 'Product', width: 30, value: (r) => r.product },
  {
    header: 'Terms', width: 16,
    value: (r) => (noTerms(r) ? '' : r.coverage === 'WARRANTY' ? 'Warranty (free)' : 'AMC (paid)'),
  },
  { header: 'Support hours', width: 20, value: supportHoursText },
  { header: 'Visits', width: 9, value: (r) => r.visits ?? '' },
  { header: 'Contract start', width: 14, value: (r) => dateCell(r.start) },
  { header: 'Contract end', width: 14, value: (r) => dateCell(r.end) },
  { header: 'Contract amount', width: 16, value: (r) => r.amount ?? '' },
];

/** One client × product × module, with its consultants per track. */
export interface ConsultantSheetRow {
  clientName: string;
  product: string;
  module: string;
  technical: string;
  functional: string;
  others: string;
}

export const CONSULTANT_COLUMNS: SheetColumn<ConsultantSheetRow>[] = [
  { header: 'Client name', width: 28, value: (r) => r.clientName },
  { header: 'Product', width: 24, value: (r) => r.product },
  { header: 'Module', width: 20, value: (r) => r.module },
  { header: 'Technical', width: 28, value: (r) => r.technical },
  { header: 'Functional', width: 28, value: (r) => r.functional },
  { header: 'Others', width: 28, value: (r) => r.others },
];
