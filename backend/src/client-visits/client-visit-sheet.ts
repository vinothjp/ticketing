import { SheetColumn, dateCell } from '../lib/spreadsheet';

/**
 * Status as a person reads it in a column. `VISIT_STATUS_LABELS` in the DTO is
 * lower-case because it is spliced into notification sentences.
 */
const STATUS: Record<string, string> = {
  PLANNED: 'Planned',
  VISITED: 'Visited',
  RESCHEDULE_REQUESTED: 'Reschedule requested',
};

/**
 * One visit as the export writes it: the list row plus the ticket number, which
 * the visit holds only as an id.
 */
export interface ClientVisitSheetRow {
  visitNumber?: string | null;
  visitDate: Date | string;
  customerCompany?: { name: string } | null;
  consultantName?: string | null;
  productName?: string | null;
  hours: unknown;
  status: string;
  rescheduleCount: number;
  ticketNumber?: string | null;
  purpose: string;
  notes?: string | null;
}

/** Two decimals at most, matching the hours on the visit screens. */
const hours = (n: unknown) => Number((Number(n) || 0).toFixed(2));

/**
 * The client-visit export's columns. Export only, like the ticket sheet — a
 * visit draws down a contract pool on the way in, which a sheet row can't be
 * trusted to do — so there is no template and no import.
 */
export const CLIENT_VISIT_COLUMNS: SheetColumn<ClientVisitSheetRow>[] = [
  { header: 'Visit #', value: (r) => r.visitNumber ?? '', width: 12 },
  { header: 'Date', value: (r) => dateCell(r.visitDate), width: 12 },
  { header: 'Client', value: (r) => r.customerCompany?.name ?? '', width: 24 },
  { header: 'Consultant', value: (r) => r.consultantName ?? '', width: 20 },
  { header: 'Product', value: (r) => r.productName ?? '', width: 22 },
  { header: 'Hours', value: (r) => hours(r.hours), width: 8 },
  { header: 'Status', value: (r) => STATUS[r.status] ?? r.status, width: 20 },
  { header: 'Times rescheduled', value: (r) => r.rescheduleCount, width: 12 },
  { header: 'Ticket #', value: (r) => r.ticketNumber ?? '', width: 14 },
  { header: 'Purpose', value: (r) => r.purpose, width: 40 },
  { header: 'Notes', value: (r) => r.notes ?? '', width: 50 },
];
