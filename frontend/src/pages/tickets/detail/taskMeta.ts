/**
 * Mirrors `backend/src/tasks/task-status.ts`. A task's status is the only clock
 * it has — every change is stamped server-side and the trail is what the task
 * dialog shows as its audit — so the four values and their labels need to read
 * the same on both sides.
 */
export const TASK_STATUSES = [
  { value: 'OPEN', label: 'Open' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'DONE', label: 'Done' },
  { value: 'CANCELLED', label: 'Cancelled' },
] as const;

export const taskStatusLabel = (value?: string | null) =>
  TASK_STATUSES.find((s) => s.value === value)?.label ?? value ?? '—';

/** Settled: nobody is waiting on it, and it no longer blocks resolving the ticket. */
export const isSettledTask = (status?: string | null) =>
  status === 'DONE' || status === 'CANCELLED';

export const taskStatusVariant = (status?: string | null) =>
  status === 'DONE' ? 'success'
  : status === 'CANCELLED' ? 'outline'
  : status === 'IN_PROGRESS' ? 'warning'
  : 'secondary';

/** A stamp on the task audit — always absolute; the point of the trail is the time. */
export const stampLabel = (iso: string | Date) =>
  new Date(iso).toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

/** Hours, in the shape every ticket screen quotes them. */
export const hrs = (n: number) => `${Math.round(n * 100) / 100} h`;

/**
 * The status pill in the task grid: bold and colour-coded by where the task
 * stands, so a column of them reads at a glance. Distinct from
 * `taskStatusVariant`, which maps onto the shared Badge variants — these are the
 * grid's own palette (grey / blue / green), and a cancelled task keeps the
 * strike-through it carries everywhere else.
 */
export const taskStatusPill = (status?: string | null) =>
  status === 'DONE' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
  : status === 'IN_PROGRESS' ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300'
  : status === 'CANCELLED' ? 'bg-muted text-muted-foreground line-through'
  : 'bg-muted text-foreground';
