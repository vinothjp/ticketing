/**
 * Where an asset stands with the employee holding it. Its own file so
 * `AssetsService`, `AssetAllocationsService` and `ApprovalsService` can all
 * import it without a module cycle — the same reason `tasks/task-status.ts`
 * exists.
 *
 * Deliberately NOT an option list: `RETURNED` is the one status that puts an
 * asset back on the shelf, so application code branches on the literal, and
 * `option-lists/default-lists.ts` keeps such statuses out of the registry.
 */
export const ALLOCATION_STATUSES = ['ISSUED', 'RETURNED', 'BROKEN', 'NOT_RETURNED'] as const;

export type AllocationStatus = (typeof ALLOCATION_STATUSES)[number];

export const ALLOCATION_STATUS_LABELS: Record<string, string> = {
  ISSUED: 'Issued',
  RETURNED: 'Returned',
  BROKEN: 'Broken',
  NOT_RETURNED: 'Not returned',
};

/**
 * The statuses that still hold the unit — everything except RETURNED. A broken
 * or un-returned asset is just as unavailable to the next person as one in
 * active use, so all three block a fresh allocation.
 */
export const OPEN_ALLOCATION_STATUSES: string[] = ALLOCATION_STATUSES.filter((s) => s !== 'RETURNED');

export const isOpenAllocation = (status?: string | null) =>
  !!status && OPEN_ALLOCATION_STATUSES.includes(status);

export const allocationStatusLabel = (status?: string | null) =>
  (status && ALLOCATION_STATUS_LABELS[status]) || status || '-';
