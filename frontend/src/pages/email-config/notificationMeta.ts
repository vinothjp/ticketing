/**
 * Mirror of `backend/src/notification-rules/notification-vocab.ts` — the fixed
 * events and recipients of the Email Configuration screen. Keep the two in step.
 */
export const NOTIFICATION_EVENTS: { value: string; label: string }[] = [
  { value: 'TICKET_CREATED', label: 'Ticket created' },
  { value: 'TICKET_ASSIGNED', label: 'Ticket assigned' },
  { value: 'TICKET_REASSIGNED', label: 'Ticket reassigned' },
  { value: 'TICKET_ACCEPTED', label: 'Ticket accepted' },
  { value: 'INFO_REQUESTED', label: 'Additional information requested' },
  { value: 'REQUESTER_RESPONDED', label: 'Employee responded' },
  { value: 'TICKET_IN_PROGRESS', label: 'Ticket in progress' },
  { value: 'TICKET_RESOLVED', label: 'Ticket resolved' },
  { value: 'TICKET_REOPENED', label: 'Ticket reopened' },
  { value: 'TICKET_CLOSED', label: 'Ticket closed' },
  { value: 'SLA_BREACHED', label: 'SLA breached' },
  { value: 'TICKET_ESCALATED', label: 'Ticket escalated' },
];

export const NOTIFICATION_RECIPIENTS: { value: string; label: string }[] = [
  { value: 'REQUESTOR', label: 'Requestor' },
  { value: 'ASSIGNED_AGENT', label: 'Assigned agent' },
  { value: 'NEW_ASSIGNED_AGENT', label: 'New assigned agent' },
  { value: 'PREVIOUS_AGENT', label: 'Previous agent' },
  { value: 'HELPDESK_EMAIL', label: 'Helpdesk email' },
  { value: 'PROJECT_MANAGER', label: 'Project Manager' },
  { value: 'CLIENT_ADMIN', label: 'Client admin' },
  { value: 'TENANT_ADMINS', label: 'Admin' },
];

/** An address, not a user: it can be emailed but never belled. */
export const EMAIL_ONLY_RECIPIENTS = ['HELPDESK_EMAIL'];

export interface NotificationRule {
  event: string;
  recipients: string[];
  email: boolean;
  bell: boolean;
}

const row = (event: string, recipients: string[], email: boolean, bell: boolean): NotificationRule => ({ event, recipients, email, bell });

/** A tenant's starting matrix — same as the backend's `DEFAULT_RULES` (the team lead's list plus the notices sent before). */
export const DEFAULT_RULES: NotificationRule[] = [
  row('TICKET_CREATED', ['REQUESTOR', 'HELPDESK_EMAIL'], true, true),
  row('TICKET_CREATED', ['ASSIGNED_AGENT'], true, false),
  row('TICKET_CREATED', ['TENANT_ADMINS', 'PROJECT_MANAGER'], false, true),
  row('TICKET_ASSIGNED', ['ASSIGNED_AGENT', 'TENANT_ADMINS', 'HELPDESK_EMAIL'], true, true),
  row('TICKET_ASSIGNED', ['PROJECT_MANAGER'], false, true),
  row('TICKET_REASSIGNED', ['NEW_ASSIGNED_AGENT', 'REQUESTOR', 'CLIENT_ADMIN', 'TENANT_ADMINS', 'HELPDESK_EMAIL'], true, true),
  row('TICKET_REASSIGNED', ['PREVIOUS_AGENT', 'PROJECT_MANAGER'], false, true),
  row('TICKET_ACCEPTED', ['REQUESTOR', 'CLIENT_ADMIN', 'HELPDESK_EMAIL'], true, true),
  row('INFO_REQUESTED', ['REQUESTOR', 'HELPDESK_EMAIL'], true, true),
  row('REQUESTER_RESPONDED', ['ASSIGNED_AGENT', 'HELPDESK_EMAIL'], true, false),
  row('TICKET_IN_PROGRESS', ['REQUESTOR', 'HELPDESK_EMAIL'], true, false),
  row('TICKET_RESOLVED', ['REQUESTOR', 'HELPDESK_EMAIL'], true, true),
  row('TICKET_RESOLVED', ['CLIENT_ADMIN', 'PROJECT_MANAGER'], false, true),
  row('TICKET_REOPENED', ['ASSIGNED_AGENT', 'HELPDESK_EMAIL'], true, true),
  row('TICKET_REOPENED', ['TENANT_ADMINS', 'PROJECT_MANAGER'], false, true),
  row('TICKET_CLOSED', ['REQUESTOR', 'ASSIGNED_AGENT', 'HELPDESK_EMAIL'], true, true),
  row('TICKET_CLOSED', ['CLIENT_ADMIN', 'PROJECT_MANAGER'], false, true),
  row('SLA_BREACHED', ['ASSIGNED_AGENT', 'HELPDESK_EMAIL'], true, true),
  row('TICKET_ESCALATED', ['PROJECT_MANAGER', 'HELPDESK_EMAIL'], true, true),
];

export const recipientLabel = (v: string) => NOTIFICATION_RECIPIENTS.find((r) => r.value === v)?.label ?? v;

/** One recipient of an event and how they are told. */
export interface EventTarget {
  recipient: string;
  email: boolean;
  bell: boolean;
}
/** The screen's row: one per event, each recipient with its own Email / Bell. */
export interface EventRow {
  event: string;
  targets: EventTarget[];
}

const RECIPIENT_ORDER = NOTIFICATION_RECIPIENTS.map((r) => r.value);

/** Stored rules (several per event allowed) → one row per event, in first-seen order. */
export function groupRules(rules: NotificationRule[]): EventRow[] {
  const rows: EventRow[] = [];
  for (const r of rules) {
    let row = rows.find((x) => x.event === r.event);
    if (!row) rows.push((row = { event: r.event, targets: [] }));
    for (const recipient of r.recipients) {
      const t = row.targets.find((x) => x.recipient === recipient);
      if (t) {
        t.email ||= r.email;
        t.bell ||= r.bell;
      } else {
        row.targets.push({ recipient, email: r.email, bell: r.bell });
      }
      // An address takes no bell, whatever row it was saved in.
      if (EMAIL_ONLY_RECIPIENTS.includes(recipient)) row.targets.find((x) => x.recipient === recipient)!.bell = false;
    }
  }
  return rows;
}

/**
 * One row per event → the stored shape: a rule per distinct Email/Bell pair, so
 * the backend (which merges an event's rules per person) reads it unchanged.
 * Targets ticked for nothing are dropped.
 */
export function expandRows(rows: EventRow[]): NotificationRule[] {
  const out: NotificationRule[] = [];
  for (const row of rows) {
    for (const [email, bell] of [[true, true], [true, false], [false, true]] as const) {
      const recipients = row.targets
        .filter((t) => t.email === email && t.bell === bell)
        .map((t) => t.recipient)
        .sort((a, b) => RECIPIENT_ORDER.indexOf(a) - RECIPIENT_ORDER.indexOf(b));
      if (recipients.length) out.push({ event: row.event, recipients, email, bell });
    }
  }
  return out;
}
