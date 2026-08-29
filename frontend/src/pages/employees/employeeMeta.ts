/**
 * Mirrors `backend/src/assets/allocation-status.ts`. An allocation's status is
 * what decides whether the asset is back on the shelf, so the four values and
 * their labels have to read the same on both sides.
 *
 * Deliberately not an option list — RETURNED is the one status that frees an
 * asset, so code branches on the literal.
 */
export const ALLOCATION_STATUSES = [
  { value: 'ISSUED', label: 'Issued' },
  { value: 'RETURNED', label: 'Returned' },
  { value: 'BROKEN', label: 'Broken' },
  { value: 'NOT_RETURNED', label: 'Not returned' },
] as const;

export const allocationStatusLabel = (value?: string | null) =>
  ALLOCATION_STATUSES.find((s) => s.value === value)?.label ?? value ?? '-';

/** Everything except RETURNED still has the unit off the shelf. */
export const isOpenAllocation = (status?: string | null) => !!status && status !== 'RETURNED';

/**
 * The status pill in the allocation grid, in the same mould as `taskStatusPill`:
 * bold and colour-coded so a column of them reads at a glance. Green is the
 * settled state here — the asset is back — while blue is in-use, red is broken
 * and amber is the one that needs chasing.
 */
export const allocationStatusPill = (status?: string | null) =>
  status === 'RETURNED' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
  : status === 'ISSUED' ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300'
  : status === 'BROKEN' ? 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300'
  : status === 'NOT_RETURNED' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
  : 'bg-muted text-foreground';

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

export interface AssetAllocation {
  id: string;
  assetId: string;
  employeeUserId: string;
  status: string;
  issuedDate?: string | null;
  returnDate?: string | null;
  notes?: string | null;
  assetCode?: string | null;
  assetName?: string | null;
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
