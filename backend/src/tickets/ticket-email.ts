import { renderLetter } from '../lib/letter-email';

/**
 * Ticket emails, worded from the team lead's templates and drawn in the plain
 * letter layout (`lib/letter-email.ts`). Each event names the rows of its own
 * "Ticket Details" table (`fields`) — the Created email shows category and
 * department, the Assigned one the SLA due date, and so on — and the facts
 * behind them are loaded once per email event by `TicketsService.ticketEmailFacts`.
 */

/** Everything any ticket email can show. A blank value drops its row. */
export interface TicketEmailFacts {
  ticketId: string;
  ticketNumber: string;
  subject: string;
  category?: string | null;
  subCategory?: string | null;
  client?: string | null;
  product?: string | null;
  priority?: string | null;
  status?: string | null;
  createdDate?: string | null;
  requestedBy?: string | null;
  department?: string | null;
  assignedAgent?: string | null;
  /** Product · module · track — the consultant group the ticket is routed to. */
  assignedTeam?: string | null;
  dueDate?: string | null;
  resolvedDate?: string | null;
  closedDate?: string | null;
  description?: string | null;
  resolution?: string | null;
  /** By the tenant's own priority label, so a renamed value still counts. */
  isCritical?: boolean;
  /** The tenant's name — the sign-off reads "<orgName> Support Team". */
  orgName?: string | null;
  /** FRONTEND_URL; without it the email carries no link. */
  portalUrl?: string | null;
}

const FIELD_LABEL = {
  number: 'Ticket Number',
  subject: 'Subject',
  requestedBy: 'Requested By',
  client: 'Client',
  product: 'Product',
  department: 'Department',
  category: 'Category',
  subCategory: 'Subcategory',
  priority: 'Priority',
  status: 'Status',
  assignedTeam: 'Assigned Team',
  assignedAgent: 'Assigned Agent',
  createdDate: 'Created Date',
  dueDate: 'SLA Due Date',
  resolvedDate: 'Resolution Date',
  closedDate: 'Closed Date',
} as const;
export type TicketFieldKey = keyof typeof FIELD_LABEL;

/** A row: a known field, a known field under another label, or a one-off label/value pair. */
export type TicketField = TicketFieldKey | { key: TicketFieldKey; label: string } | [string, string | null | undefined];

/** One event's own wording. Every string is plain text — it is escaped on render. */
export interface TicketEmailContent {
  intro: string;
  fields: TicketField[];
  /** Adds the ticket's description as "Issue Description". */
  description?: boolean;
  /** Adds the ticket's resolution notes under this title, e.g. "Resolution Details". */
  resolution?: string;
  /** Titled blocks after those, e.g. Reason for Reopening. */
  sections?: { title: string; body: string | null | undefined }[];
  outro?: string;
  /** The link line's label, e.g. "View Assigned Ticket". Default "View Ticket". */
  linkLabel?: string;
  /** The ticket path's query, e.g. "?tab=approvals". */
  linkQuery?: string;
  thanks?: string;
  /** Default "Best Regards". */
  signOff?: string;
}

const DESCRIPTION_MAX = 1200;
const clip = (s: string) => (s.length > DESCRIPTION_MAX ? `${s.slice(0, DESCRIPTION_MAX).trimEnd()}…` : s);

function value(f: TicketEmailFacts, key: TicketFieldKey): string | null | undefined {
  switch (key) {
    case 'number': return f.ticketNumber;
    case 'assignedAgent': return f.assignedAgent || 'Awaiting assignment';
    default: return f[key];
  }
}

const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const pad = (n: number) => String(n).padStart(2, '0');
/** Longest-first, as `frontend/src/lib/dateFormat.ts` matches them. */
const TOKEN = /yyyy|yy|MMMM|MMM|MM|M|dd|d|HH|hh|mm|ss|a/g;

/**
 * A date in the tenant's own token pattern (`Client.dateFormat`), mirroring the
 * frontend renderer. Dates only: the server clock is UTC and a tenant has no
 * time zone setting, so a time printed here would be hours off for the reader.
 */
export function formatTenantDate(value: Date | string | null | undefined, pattern?: string | null): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const h12 = d.getHours() % 12 || 12;
  return (pattern?.trim() || 'dd/MM/yyyy').replace(TOKEN, (t) => {
    switch (t) {
      case 'yyyy': return String(d.getFullYear());
      case 'yy': return pad(d.getFullYear() % 100);
      case 'MMMM': return MONTHS_LONG[d.getMonth()];
      case 'MMM': return MONTHS_LONG[d.getMonth()].slice(0, 3);
      case 'MM': return pad(d.getMonth() + 1);
      case 'M': return String(d.getMonth() + 1);
      case 'dd': return pad(d.getDate());
      case 'd': return String(d.getDate());
      case 'HH': return pad(d.getHours());
      case 'hh': return pad(h12);
      case 'mm': return pad(d.getMinutes());
      case 'ss': return pad(d.getSeconds());
      case 'a': return d.getHours() < 12 ? 'am' : 'pm';
      default: return t;
    }
  });
}

/** Render one ticket email. `greetName` null greets "Team" — a shared address or a group of staff. */
export function renderTicketEmail(
  facts: TicketEmailFacts,
  content: TicketEmailContent,
  greetName: string | null,
): { html: string; text: string } {
  const rows = content.fields.map((f): [string, string | null | undefined] =>
    Array.isArray(f) ? f
      : typeof f === 'string' ? [FIELD_LABEL[f], value(facts, f)]
        : [f.label, value(facts, f.key)]);
  const base = facts.portalUrl?.trim().replace(/\/$/, '');
  return renderLetter({
    greetName,
    intro: content.intro,
    table: { heading: 'Ticket Details', rows },
    sections: [
      ...(content.description && facts.description?.trim()
        ? [{ title: 'Issue Description', body: clip(facts.description.trim()) }]
        : []),
      ...(content.resolution ? [{ title: content.resolution, body: facts.resolution }] : []),
      ...(content.sections ?? []),
    ],
    outro: content.outro,
    link: { label: content.linkLabel ?? 'View Ticket', url: base ? `${base}/tickets/${facts.ticketId}${content.linkQuery ?? ''}` : null },
    thanks: content.thanks,
    signOff: content.signOff,
    orgName: facts.orgName,
  });
}
