/**
 * The asset module's fixed vocabularies. Their own file so `AssetsService`,
 * `AssetAllocationsService`, `AssetActivityService` and `ApprovalsService` can
 * all import them without a module cycle — the same reason `tasks/task-status.ts`
 * exists.
 *
 * Deliberately NOT option lists: application code branches on every literal here
 * (`RETURNED` frees an asset, `BROKEN` damages it, `UNTIL_EXIT` exempts a row
 * from chasing), so an admin renaming a value would change behaviour rather than
 * wording. `option-lists/default-lists.ts` keeps such vocabularies out of the
 * registry on that rule.
 */

/**
 * Where the allocation stands, and nothing else. It says only whether the unit is
 * out or back — how it came back is `RETURN_CONDITIONS`, and damage that outlives
 * the allocation is `ASSET_CONDITIONS`. The retired BROKEN / NOT_RETURNED
 * statuses conflated all three.
 */
export const ALLOCATION_STATUSES = ['ISSUED', 'RETURNED'] as const;

export type AllocationStatus = (typeof ALLOCATION_STATUSES)[number];

export const ALLOCATION_STATUS_LABELS: Record<string, string> = {
  ISSUED: 'Issued',
  RETURNED: 'Returned',
};

/** The statuses that still hold the unit — with two statuses, exactly ISSUED. */
export const OPEN_ALLOCATION_STATUSES: string[] = ALLOCATION_STATUSES.filter((s) => s !== 'RETURNED');

export const isOpenAllocation = (status?: string | null) =>
  !!status && OPEN_ALLOCATION_STATUSES.includes(status);

export const allocationStatusLabel = (status?: string | null) =>
  (status && ALLOCATION_STATUS_LABELS[status]) || status || '-';

/** How a unit came back. Set only while the allocation is RETURNED. */
export const RETURN_CONDITIONS = ['GOOD', 'BROKEN'] as const;

export const RETURN_CONDITION_LABELS: Record<string, string> = {
  GOOD: 'Good',
  BROKEN: 'Broken',
};

export const returnConditionLabel = (v?: string | null) =>
  (v && RETURN_CONDITION_LABELS[v]) || v || '-';

/**
 * Whether the unit is expected back during employment. UNTIL_EXIT is the phone or
 * laptop nobody hands in until they leave: it reads as a normal holding rather
 * than a permanently overdue one, and is what the exit-clearance list is built
 * from.
 */
export const RETENTIONS = ['RETURNABLE', 'UNTIL_EXIT'] as const;

export const RETENTION_LABELS: Record<string, string> = {
  RETURNABLE: 'Returnable',
  UNTIL_EXIT: 'Until exit',
};

export const retentionLabel = (v?: string | null) => (v && RETENTION_LABELS[v]) || v || '-';

/**
 * The unit's own condition, which outlives any one allocation. A BROKEN return
 * sets DAMAGED; an admin clears it back to OK once the unit is repaired. Deriving
 * "in repair" from the last allocation instead would be a state nothing could
 * ever leave.
 */
export const ASSET_CONDITIONS = ['OK', 'DAMAGED', 'RETIRED'] as const;

export const ASSET_CONDITION_LABELS: Record<string, string> = {
  OK: 'OK',
  DAMAGED: 'Damaged',
  RETIRED: 'Retired',
};

export const assetConditionLabel = (v?: string | null) =>
  (v && ASSET_CONDITION_LABELS[v]) || v || '-';
