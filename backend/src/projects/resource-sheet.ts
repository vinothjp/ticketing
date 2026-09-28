import { SheetColumn, dateCell } from '../lib/spreadsheet';

/** One resource-plan row as the export writes it — `ProjectResource` with its user and category. */
export interface ResourceSheetRow {
  consultantName?: string | null;
  role?: string | null;
  allocationPct: number;
  dailyHours: number;
  startDate?: Date | string | null;
  endDate?: Date | string | null;
  billable: boolean;
  user?: { username: string; name?: string | null; employeeId?: string | null } | null;
  category?: { name: string; hourlyCost: unknown; billingRate: unknown; dailyHours: number } | null;
}

const money = (v: unknown, hours: number) => Math.round(Number(v ?? 0) * hours * 100) / 100;

/**
 * A project's resource-plan columns. This one list drives the export, the
 * template and the header matching on import — the three can't drift apart.
 *
 * `Consultant` is the match key: a staff user already on this project's plan
 * has their row updated, anyone else is added. Daily cost / billing are
 * `exportOnly` — they are the category's rates, set on the Resource Costs
 * screen, not something a plan row can change.
 */
export const RESOURCE_COLUMNS: SheetColumn<ResourceSheetRow>[] = [
  { header: 'Consultant', aliases: ['username', 'member', 'user', 'employee id'],
    value: (r) => r.user?.username ?? r.consultantName ?? '', width: 20,
    note: 'Required. The staff user\'s username or Employee ID. Someone already on this project\'s plan is updated; anyone else is added.' },
  { header: 'Consultant name', aliases: ['name', 'full name'], value: (r) => r.user?.name ?? '', width: 24, exportOnly: true },
  { header: 'Role', value: (r) => r.role ?? '', width: 22, note: 'Free text, e.g. "Lead Developer".' },
  { header: 'Category', aliases: ['resource category', 'rate category'], value: (r) => r.category?.name ?? '', width: 20,
    note: 'The name of a category on the Resource Costs screen — it supplies the cost and billing rates. Use "none" to clear it.' },
  { header: 'Allocation %', aliases: ['allocation', 'alloc %', 'alloc'], value: (r) => r.allocationPct, width: 13,
    note: 'Whole number 0–100. Blank means 100 on a new row.' },
  { header: 'Daily hours', aliases: ['hours per day'], value: (r) => r.dailyHours, width: 12,
    note: 'Whole number, at least 1. Blank means 8 on a new row.' },
  { header: 'Start date', aliases: ['start'], value: (r) => dateCell(r.startDate), width: 14,
    note: 'Date, e.g. 2026-04-15. Blank uses the project\'s start date on a new row.' },
  { header: 'End date', aliases: ['end'], value: (r) => dateCell(r.endDate), width: 14,
    note: 'Date, e.g. 2026-12-31. Blank uses the project\'s end date on a new row.' },
  { header: 'Billable', value: (r) => (r.billable ? 'Yes' : 'No'), width: 10,
    note: 'Yes or No. Blank means Yes on a new row.' },

  { header: 'Daily cost', value: (r) => (r.category ? money(r.category.hourlyCost, r.category.dailyHours) : ''), width: 12, exportOnly: true },
  { header: 'Daily billing', value: (r) => (r.category ? money(r.category.billingRate, r.category.dailyHours) : ''), width: 13, exportOnly: true },
];

export const RESOURCE_IMPORT_NOTES = [
  'Fill one row per consultant on the plan. The first row must stay as the headers.',
  'Consultant is the match key: someone already on this project\'s plan is updated, anyone else is added.',
  'On an update, a blank cell leaves the stored value alone — clear a field on the Resources tab instead.',
  'Categories and their rates are managed on the Resource Costs screen; this sheet only picks one by name.',
];
