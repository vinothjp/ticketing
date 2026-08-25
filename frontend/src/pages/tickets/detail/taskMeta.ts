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
