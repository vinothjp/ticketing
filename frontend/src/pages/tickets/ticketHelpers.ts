export interface TicketTechnicianRow {
  user: { id: string; username: string };
}

export interface TicketSummary {
  id: string;
  ticketNumber: string;
  subject: string;
  description?: string | null;
  priority?: string | null;
  ticketStatus: string;
  approvalStatus?: string | null;
  rejectionReason?: string | null;
  requestorName?: string | null;
  requestorUserId?: string | null;
  department?: string | null;
  ticketCategory?: string | null;
  dueDate?: string | null;
  slaHours?: number | null;
  closedDate?: string | null;
  createdAt: string;
  template: { id: string; name: string; category?: string | null };
  technicians: TicketTechnicianRow[];
  customerCompany?: { id: string; name: string } | null;
}

/** Badge for the creation-approval gate. Returns null for NONE/APPROVED (no badge needed). */
export function getApprovalMeta(status?: string | null): { label: string; className: string } | null {
  const amber = 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30';
  if (status === 'PENDING_CUSTOMER')
    return { label: 'Awaiting manager', className: amber };
  if (status === 'PENDING')
    return { label: 'Approval Pending', className: amber };
  if (status === 'REJECTED')
    return { label: 'Rejected', className: 'bg-destructive/15 text-destructive border-destructive/30' };
  return null;
}

const NEUTRAL_BADGE = 'bg-muted text-muted-foreground border-transparent';

const PRIORITY_META: Record<string, { label: string; code: string; barClass: string; textClass: string; badgeClass: string }> = {
  critical: { label: 'Critical', code: 'P1', barClass: 'bg-destructive', textClass: 'text-destructive', badgeClass: 'bg-destructive/15 text-destructive border-destructive/30' },
  high: { label: 'High', code: 'P2', barClass: 'bg-amber-500', textClass: 'text-amber-500', badgeClass: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30' },
  medium: { label: 'Medium', code: 'P3', barClass: 'bg-sky-500', textClass: 'text-sky-500', badgeClass: 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30' },
  low: { label: 'Low', code: 'P4', barClass: 'bg-slate-400', textClass: 'text-slate-400', badgeClass: 'bg-slate-400/20 text-slate-600 dark:text-slate-300 border-slate-400/40' },
};

export function getPriorityMeta(priority?: string | null) {
  if (!priority) return { label: '—', code: '', barClass: 'bg-muted', textClass: 'text-muted-foreground', badgeClass: NEUTRAL_BADGE };
  return PRIORITY_META[priority.toLowerCase()] ?? { label: priority, code: '', barClass: 'bg-muted', textClass: 'text-muted-foreground', badgeClass: NEUTRAL_BADGE };
}

export function isTerminalStatus(statusLabel?: string | null) {
  const s = (statusLabel ?? '').toLowerCase();
  return s === 'resolved' || s === 'closed';
}

/** Overdue = past its due date and not yet resolved/closed (a condition, not a status). */
export function isOverdueTicket(t: Pick<TicketSummary, 'ticketStatus' | 'dueDate'>) {
  return !isTerminalStatus(t.ticketStatus) && !!t.dueDate && new Date(t.dueDate) < new Date();
}

/** Raised today (local day, same convention as the dashboard's "Due today") and not yet overdue. */
export function isCreatedTodayTicket(t: Pick<TicketSummary, 'ticketStatus' | 'dueDate' | 'createdAt'>) {
  return new Date(t.createdAt).toDateString() === new Date().toDateString() && !isOverdueTicket(t);
}

export function formatDueStatus(dueDate?: string | null, statusLabel?: string | null): { label: string; tone: 'overdue' | 'today' | 'soon' | 'ok' | 'none' } {
  if (isTerminalStatus(statusLabel)) return { label: statusLabel ?? '', tone: 'ok' };
  if (!dueDate) return { label: 'No due date', tone: 'none' };

  const due = new Date(dueDate);
  const now = new Date();
  const diffMs = due.getTime() - now.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMs < 0) return { label: 'Overdue', tone: 'overdue' };
  if (diffDays === 0) return { label: 'Due today', tone: 'today' };
  if (diffDays === 1) return { label: 'Due tomorrow', tone: 'soon' };
  return { label: `Due in ${diffDays}d`, tone: 'ok' };
}

/**
 * How much of the SLA window is left, as one of three grades — the single place
 * the thresholds live, so the list badge and the detail countdown card can never
 * disagree about when a ticket turns amber.
 *
 * The warning point is a *fraction* of the ticket's own `slaHours` rather than a
 * fixed cut-off, so a 4h critical and a 72h low both turn amber at the same point
 * in their life (falls back to 48h for a ticket with no policy behind it).
 * `none` is the clock-stopped / no-due-date case, which is graded by neither.
 */
export type SlaTone = 'ok' | 'soon' | 'overdue' | 'none';

export function slaTone(diffMs: number, slaHours?: number | null): Exclude<SlaTone, 'none'> {
  if (diffMs < 0) return 'overdue';
  const windowMs = (slaHours && slaHours > 0 ? slaHours : 48) * 60 * 60 * 1000;
  return diffMs / windowMs <= 0.25 ? 'soon' : 'ok';
}

/** Pill on a ticket row. */
export const SLA_BADGE_CLASS: Record<SlaTone, string> = {
  ok: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
  soon: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
  overdue: 'bg-destructive/15 text-destructive border-destructive/30',
  none: NEUTRAL_BADGE,
};

/** The countdown panel on the ticket detail screen — same grades, panel-shaped. */
export const SLA_PANEL_CLASS: Record<SlaTone, { box: string; label: string; value: string; bar: string }> = {
  ok: {
    box: 'border-emerald-500/30 bg-emerald-500/10',
    label: 'text-emerald-700 dark:text-emerald-400',
    value: 'text-emerald-700 dark:text-emerald-300',
    bar: 'bg-emerald-500',
  },
  soon: {
    box: 'border-amber-500/30 bg-amber-500/10',
    label: 'text-amber-700 dark:text-amber-400',
    value: 'text-amber-700 dark:text-amber-300',
    bar: 'bg-amber-500',
  },
  overdue: {
    box: 'border-destructive/40 bg-destructive/5',
    label: 'text-destructive',
    value: 'text-destructive',
    bar: 'bg-destructive',
  },
  none: {
    box: 'border-border/70 bg-muted/20',
    label: 'text-muted-foreground',
    value: 'text-foreground',
    bar: 'bg-muted-foreground/40',
  },
};

export function formatCountdown(dueDate?: string | null, slaHours?: number | null): { label: string; overdue: boolean; fraction: number; tone: SlaTone } {
  if (!dueDate) return { label: 'No due date set', overdue: false, fraction: 0, tone: 'none' };
  const due = new Date(dueDate).getTime();
  const now = Date.now();
  const diffMs = due - now;
  const overdue = diffMs < 0;
  const abs = Math.abs(diffMs);
  const hours = Math.floor(abs / (1000 * 60 * 60));
  const mins = Math.floor((abs % (1000 * 60 * 60)) / (1000 * 60));
  const label = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  // Fraction remaining against the real SLA window (falls back to 48h if unknown).
  const windowMs = (slaHours && slaHours > 0 ? slaHours : 48) * 60 * 60 * 1000;
  const fraction = overdue ? 0 : Math.max(0, Math.min(1, diffMs / windowMs));
  return { label: overdue ? `Overdue by ${label}` : `${label} left`, overdue, fraction, tone: slaTone(diffMs, slaHours) };
}

/**
 * SLA badge for a ticket row: how much of the SLA window is left, as a single
 * figure — hours once there is an hour or more, minutes below that, and negative
 * once the due date has gone by.
 *
 * Green until the last quarter of the window, amber inside it, red overdue. The
 * warning point is a *fraction* of the ticket's own `slaHours` rather than a fixed
 * cut-off, so a 4h critical and a 72h low both turn amber at the same point in
 * their life (falls back to 48h for a ticket with no policy behind it).
 */
export function getSlaMeta(t: Pick<TicketSummary, 'dueDate' | 'slaHours' | 'ticketStatus'>): { label: string; className: string; title: string } {
  // The clock stops on resolve/close. Read that off the live status, not
  // `closedDate` — a ticket moved back out of Closed needs its countdown back.
  if (isTerminalStatus(t.ticketStatus)) return { label: '—', className: SLA_BADGE_CLASS.none, title: 'SLA clock stopped' };
  if (!t.dueDate) return { label: '—', className: SLA_BADGE_CLASS.none, title: 'No due date set' };

  const diffMs = new Date(t.dueDate).getTime() - Date.now();
  const abs = Math.abs(diffMs);
  const hours = Math.floor(abs / (1000 * 60 * 60));
  const mins = Math.floor((abs % (1000 * 60 * 60)) / (1000 * 60));
  const amount = hours > 0 ? `${hours}h` : `${mins}m`;
  const full = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

  const tone = slaTone(diffMs, t.slaHours);
  return {
    label: tone === 'overdue' ? `-${amount}` : amount,
    className: SLA_BADGE_CLASS[tone],
    title: tone === 'overdue' ? `Overdue by ${full}` : `${full} left`,
  };
}

export type FieldGroup = 'ticket_info' | 'ticket_detail' | 'root_cause';

export const FIELD_GROUP_LABELS: Record<FieldGroup, string> = {
  ticket_info: 'Ticket Info',
  ticket_detail: 'Ticket Detail',
  root_cause: 'Root Cause Analysis',
};

/**
 * Split fields — already in the admin's `sortOrder` — into contiguous runs of the same group.
 *
 * The form used to render a fixed Ticket Info -> Ticket Detail -> Root Cause sequence, which
 * silently discarded any reordering the Template Designer made across groups (dragging Subject
 * above Priority did nothing). Rendering runs instead means the designer's top-to-bottom order
 * is what requesters see; headings still appear, they just follow the fields.
 */
export function groupFieldRuns<T extends { group: FieldGroup }>(fields: T[]): { group: FieldGroup; fields: T[] }[] {
  const runs: { group: FieldGroup; fields: T[] }[] = [];
  for (const f of fields) {
    const last = runs[runs.length - 1];
    if (last && last.group === f.group) last.fields.push(f);
    else runs.push({ group: f.group, fields: [f] });
  }
  return runs;
}
