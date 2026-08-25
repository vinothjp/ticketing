/**
 * `TicketTask.status` is a plain String column, so these are the whole contract.
 *
 * Lives in its own file because both sides of the ticket/task relationship need
 * it: `TasksService` validates writes against it, and `TicketsService` reads it
 * to decide whether a ticket may be resolved. A constants module has no
 * dependency of its own, so neither import risks a cycle.
 */
export const TASK_STATUSES = ['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/**
 * A task nobody is waiting on any more. DONE is the work finishing; CANCELLED is
 * the honest way to clear a task that turned out not to be needed, rather than
 * ticking it done or deleting the record. Everything else blocks a resolve and
 * stays in the assignee's queue.
 */
export const SETTLED_TASK_STATUSES: TaskStatus[] = ['DONE', 'CANCELLED'];

/**
 * Human labels for the four statuses. Used in the activity summaries the ticket
 * History renders, so a reader sees "Open → In progress" rather than the codes.
 */
export const TASK_STATUS_LABELS: Record<string, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  DONE: 'Done',
  CANCELLED: 'Cancelled',
};

/** The one status that accrues time. Everything else stops the clock. */
export const RUNNING_TASK_STATUS = 'IN_PROGRESS';
