/**
 * Mirrors `backend/src/assets/allocation-status.ts`. These vocabularies decide
 * whether an asset is back on the shelf and how the register reads, so the values
 * and their labels have to match on both sides.
 *
 * Deliberately not option lists — code branches on every literal here.
 */

/**
 * Where the allocation stands, and nothing else: out, or back. How it came back
 * is `RETURN_CONDITIONS`; damage that outlives the allocation is the asset's own
 * condition. The retired BROKEN / NOT_RETURNED statuses conflated all three.
 */
export const ALLOCATION_STATUSES = [
  { value: 'ISSUED', label: 'Issued' },
  { value: 'RETURNED', label: 'Returned' },
] as const;

export const allocationStatusLabel = (value?: string | null) =>
  ALLOCATION_STATUSES.find((s) => s.value === value)?.label ?? value ?? '-';

/** Everything except RETURNED still has the unit off the shelf. */
export const isOpenAllocation = (status?: string | null) => !!status && status !== 'RETURNED';

/**
 * The status pill in the allocation grid, in the same mould as `taskStatusPill`:
 * bold and colour-coded so a column of them reads at a glance. Green is the
 * settled state here — the asset is back — while blue is in-use.
 */
export const allocationStatusPill = (status?: string | null) =>
  status === 'RETURNED' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
  : status === 'ISSUED' ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300'
  : 'bg-muted text-foreground';

/** How a unit came back. Set only while the allocation is RETURNED. */
export const RETURN_CONDITIONS = [
  { value: 'GOOD', label: 'Good' },
  { value: 'BROKEN', label: 'Broken' },
] as const;

export const returnConditionLabel = (v?: string | null) =>
  RETURN_CONDITIONS.find((c) => c.value === v)?.label ?? v ?? '-';

export const returnConditionPill = (v?: string | null) =>
  v === 'BROKEN' ? 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300'
  : v === 'GOOD' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
  : 'bg-muted text-foreground';

/**
 * Whether the unit is expected back during employment. `UNTIL_EXIT` is the phone
 * or laptop nobody hands in until they leave: it reads as a normal holding rather
 * than a permanently overdue one, and is what the exit-clearance banner on the
 * employee screen is built from.
 */
export const RETENTIONS = [
  { value: 'RETURNABLE', label: 'Returnable' },
  { value: 'UNTIL_EXIT', label: 'Until exit' },
] as const;

export const retentionLabel = (v?: string | null) =>
  RETENTIONS.find((r) => r.value === v)?.label ?? v ?? '-';

/**
 * The unit's own condition, which outlives any one allocation — a broken return
 * sets DAMAGED, and an admin clears it back to OK once the unit is repaired.
 */
export const ASSET_CONDITIONS = [
  { value: 'OK', label: 'OK' },
  { value: 'DAMAGED', label: 'Damaged' },
  { value: 'RETIRED', label: 'Retired' },
] as const;

export const assetConditionLabel = (v?: string | null) =>
  ASSET_CONDITIONS.find((c) => c.value === v)?.label ?? v ?? '-';

export const assetConditionPill = (v?: string | null) =>
  v === 'DAMAGED' ? 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300'
  : v === 'RETIRED' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
  : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300';

export interface Employee {
  id: string;
  username: string;
  name?: string | null;
  email: string;
  isActive: boolean;
  employeeId?: string | null;
  department?: string | null;
  designation?: string | null;
  phone?: string | null;
  managerId?: string | null;
  manager?: { id: string; name?: string | null; username: string } | null;
  userRoles?: { role: { name: string } }[];
}

/**
 * One allocation row, as `GET api/asset-allocations` returns it. It carries both
 * sides — the denormalised asset code/name and the live employee facts — so the
 * one grid component can render it from either master without a second query.
 */
export interface AssetAllocation {
  id: string;
  assetId: string;
  employeeUserId: string;
  status: string;
  returnCondition?: string | null;
  retention: string;
  expectedReturnDate?: string | null;
  issuedDate?: string | null;
  returnDate?: string | null;
  notes?: string | null;
  assetCode?: string | null;
  assetName?: string | null;
  employeeCode?: string | null;
  employeeName?: string | null;
  department?: string | null;
  designation?: string | null;
  employeeActive?: boolean;
}

export interface AssetOption {
  id: string;
  assetId: string;
  assetName: string;
  assetType?: string | null;
}

/** The display name for a person — the full name, falling back to the username. */
export const personName = (u?: { name?: string | null; username?: string } | null) =>
  u?.name || u?.username || '-';

/**
 * A staff user carrying the **Manager** role. Deliberately not Admin — that is an
 * administrative right over the tenant, not a reporting line, and reading it here
 * put every admin in every employee's manager dropdown. Mirrors
 * `UsersService.assertManager`, which refuses anyone else on save.
 */
export const isManager = (u: Employee) => !!u.userRoles?.some((r) => r.role.name === 'Manager');

/** `Date` | ISO -> the `YYYY-MM-DD` a date input wants. '' when absent. */
export const dateInputValue = (v?: string | null) => (v ? new Date(v).toISOString().slice(0, 10) : '');

/**
 * A returnable holding whose due date has passed. An `UNTIL_EXIT` row is never
 * overdue by definition — that is the whole point of the flag — and a returned
 * one is settled.
 */
export const isOverdue = (a: Pick<AssetAllocation, 'status' | 'retention' | 'expectedReturnDate'>) =>
  a.status === 'ISSUED' &&
  a.retention !== 'UNTIL_EXIT' &&
  !!a.expectedReturnDate &&
  new Date(a.expectedReturnDate) < new Date(new Date().toDateString());
