/**
 * Mirrors `backend/src/tasks/task-status.ts`. A task's status is the only clock
 * it has — every change is stamped server-side and the trail is what the task
 * dialog shows as its audit — so the four values and their labels need to read
 * the same on both sides.
 */
export const TASK_STATUSES = [
  { value: 'OPEN', label: 'Open' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'DONE', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
] as const;

/**
 * The settled status a task is *reopened* out of. Stored as `DONE` — the value
 * every existing row, status event and `SETTLED_TASK_STATUSES` check is keyed on
 * — and read as "Completed" wherever a person sees it.
 */
export const COMPLETED_TASK_STATUS = 'DONE';

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

// (No date helper here on purpose: every stamp on the ticket screens goes through
// `useDateFormat()` in `lib/dateFormat.ts`, so it is written in the tenant's own
// format rather than the browser's.)

/**
 * Hours, in the shape every ticket screen quotes them: two decimals at most,
 * trailing zeros trimmed. A stretch too short to reach a hundredth of an hour
 * reads as "0 h" — the precise figure is still what the pool was charged.
 */
export const hrs = (n: number) => `${Number(Math.max(0, Number(n) || 0).toFixed(2))} h`;

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

/**
 * A task's own id, as the grid and the edit screen show it: `T-001`, numbered
 * per ticket. `taskNumber` is null only on rows written before the column
 * existed and never backfilled, so those fall back to the head of the uuid —
 * still stable, still unique, just not sequential.
 */
export const taskCode = (task: { taskNumber?: number | null; id: string }) =>
  task.taskNumber != null
    ? `T-${String(task.taskNumber).padStart(3, '0')}`
    : `T-${task.id.slice(0, 6)}`;
