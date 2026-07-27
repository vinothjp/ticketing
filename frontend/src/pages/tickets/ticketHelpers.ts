export interface TicketTechnicianRow {
  user: { id: string; username: string };
}

export interface TicketSummary {
  id: string;
  ticketNumber: string;
  subject: string;
  priority?: string | null;
  ticketStatus: string;
  requestorName?: string | null;
  ticketCategory?: string | null;
  dueDate?: string | null;
  closedDate?: string | null;
  createdAt: string;
  template: { id: string; name: string; category?: string | null };
  technicians: TicketTechnicianRow[];
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

export function formatCountdown(dueDate?: string | null): { label: string; overdue: boolean; fraction: number } {
  if (!dueDate) return { label: 'No due date set', overdue: false, fraction: 0 };
  const due = new Date(dueDate).getTime();
  const now = Date.now();
  const diffMs = due - now;
  const overdue = diffMs < 0;
  const abs = Math.abs(diffMs);
  const hours = Math.floor(abs / (1000 * 60 * 60));
  const mins = Math.floor((abs % (1000 * 60 * 60)) / (1000 * 60));
  const label = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  // Fraction remaining assuming a 48h SLA window, clamped — purely a visual approximation.
  const fraction = overdue ? 0 : Math.max(0, Math.min(1, diffMs / (48 * 60 * 60 * 1000)));
  return { label: overdue ? `Overdue by ${label}` : `${label} left`, overdue, fraction };
}
