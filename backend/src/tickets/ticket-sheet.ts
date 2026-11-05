import { SheetColumn, dateCell } from '../lib/spreadsheet';

/**
 * One ticket as the export writes it.
 *
 * The row is assembled in `TicketsService.exportSheet` rather than being a
 * Prisma model: product and module names are looked up per id (Ticket carries
 * no relation to either), status and priority are resolved to the tenant's own
 * picklist labels, and `hoursSpent` is the booked `TicketWorklog` total — the
 * one figure every ticket screen quotes.
 */
export interface TicketSheetRow {
  ticketNumber: string;
  subject: string;
  description: string;
  status: string;
  priority: string;
  templateName: string;
  ticketCategory?: string | null;
  subCategory?: string | null;
  requestorName?: string | null;
  requestorEmail?: string | null;
  requestorContact?: string | null;
  department?: string | null;
  customerCompanyName?: string | null;
  productName?: string | null;
  moduleName?: string | null;
  consultantType?: string | null;
  assignedTo: string;
  approvalStatus: string;
  hoursSpent: number;
  openTaskCount: number;
  reopenedCount: number;
  slaHours?: number | null;
  createdAt: Date | string;
  dueDate?: Date | string | null;
  firstResponseAt?: Date | string | null;
  resolvedAt?: Date | string | null;
  acknowledgedAt?: Date | string | null;
  closedDate?: Date | string | null;
  resolution?: string | null;
}

const text = (key: keyof TicketSheetRow) => (r: TicketSheetRow) => (r[key] as string | null) ?? '';

/**
 * A stamp as `YYYY-MM-DD HH:mm`. The shared `dateCell` drops the time, which is
 * right for a purchase date but not for a ticket — a same-day due time is the
 * difference between met and breached. Local to this sheet for that reason.
 */
const stampCell = (v?: Date | string | null) => {
  if (!v) return '';
  const d = new Date(v);
  return `${dateCell(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** Two decimals at most, matching `hrs()` on the ticket screens. */
const hours = (n: number) => Number((Number(n) || 0).toFixed(2));

/**
 * The ticket export's columns.
 *
 * Export only — there is deliberately no ticket import and no blank template:
 * a ticket is built from a Template, passes the approval gate and is routed to a
 * consultant on creation, none of which a spreadsheet row can stand in for. The
 * `SheetColumn` shape is still what drives it, so this list is the single place
 * a column is added.
 */
export const TICKET_COLUMNS: SheetColumn<TicketSheetRow>[] = [
  { header: 'Ticket #', value: text('ticketNumber'), width: 14 },
  { header: 'Subject', value: text('subject'), width: 40 },
  { header: 'Status', value: text('status'), width: 16 },
  { header: 'Priority', value: text('priority'), width: 12 },
  { header: 'Type', value: text('templateName'), width: 22 },
  { header: 'Category', value: text('ticketCategory'), width: 18 },
  { header: 'Sub-category', value: text('subCategory'), width: 18 },
  { header: 'Client', value: text('customerCompanyName'), width: 24 },
  { header: 'Requester', value: text('requestorName'), width: 22 },
  { header: 'Requester email', value: text('requestorEmail'), width: 26 },
  { header: 'Requester contact', value: text('requestorContact'), width: 18 },
  { header: 'Department', value: text('department'), width: 18 },
  { header: 'Product', value: text('productName'), width: 22 },
  { header: 'Module', value: text('moduleName'), width: 22 },
  { header: 'Consultant type', value: text('consultantType'), width: 16 },
  { header: 'Assigned agent', value: text('assignedTo'), width: 20 },
  { header: 'Approval', value: text('approvalStatus'), width: 18 },
  { header: 'Time spent (h)', value: (r) => hours(r.hoursSpent), width: 14 },
  { header: 'Open tasks', value: (r) => r.openTaskCount, width: 12 },
  { header: 'Reopened', value: (r) => r.reopenedCount, width: 10 },
  { header: 'SLA (h)', value: (r) => r.slaHours ?? '', width: 10 },
  { header: 'Created', value: (r) => stampCell(r.createdAt), width: 18 },
  { header: 'Due', value: (r) => stampCell(r.dueDate), width: 18 },
  { header: 'First response', value: (r) => stampCell(r.firstResponseAt), width: 18 },
  { header: 'Resolved', value: (r) => stampCell(r.resolvedAt), width: 18 },
  { header: 'Acknowledged', value: (r) => stampCell(r.acknowledgedAt), width: 18 },
  { header: 'Closed', value: (r) => stampCell(r.closedDate), width: 18 },
  { header: 'Resolution', value: text('resolution'), width: 40 },
  { header: 'Description', value: text('description'), width: 50 },
];
