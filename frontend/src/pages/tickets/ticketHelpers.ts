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

const PRIORITY_META: Record<string, { label: string; code: string; barClass: string; textClass: string }> = {
  critical: { label: 'Critical', code: 'P1', barClass: 'bg-destructive', textClass: 'text-destructive' },
  high: { label: 'High', code: 'P2', barClass: 'bg-amber-500', textClass: 'text-amber-500' },
  medium: { label: 'Medium', code: 'P3', barClass: 'bg-sky-500', textClass: 'text-sky-500' },
  low: { label: 'Low', code: 'P4', barClass: 'bg-slate-400', textClass: 'text-slate-400' },
};

export function getPriorityMeta(priority?: string | null) {
  if (!priority) return { label: '—', code: '', barClass: 'bg-muted', textClass: 'text-muted-foreground' };
  return PRIORITY_META[priority.toLowerCase()] ?? { label: priority, code: '', barClass: 'bg-muted', textClass: 'text-muted-foreground' };
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

export function formatCountdown(dueDate?: string | null, slaHours?: number | null): { label: string; overdue: boolean; fraction: number } {
  if (!dueDate) return { label: 'No due date set', overdue: false, fraction: 0 };
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
  return { label: overdue ? `Overdue by ${label}` : `${label} left`, overdue, fraction };
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
