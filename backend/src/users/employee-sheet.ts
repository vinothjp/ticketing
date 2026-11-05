import { SheetColumn } from '../lib/spreadsheet';

/**
 * One employee as the export writes it. An employee *is* an internal staff
 * `User`, so this is that row plus the two read-back figures the Employee Master
 * shows beside it.
 */
export interface EmployeeSheetRow {
  employeeId?: string | null;
  name?: string | null;
  username: string;
  email: string;
  department?: string | null;
  designation?: string | null;
  phone?: string | null;
  isActive: boolean;
  manager?: { name?: string | null; username: string } | null;
  assetsHeld?: number;
}

/**
 * The Employee Master's columns — the export, the template and the import's
 * header matching, from one list.
 *
 * The match key is `Employee ID`, falling back to `Username`: an employee id is
 * typed by an admin and may not be filled in yet, while the username always
 * exists. A row matching neither is a new staff login, which is why the sheet
 * carries the login half at all.
 */
export const EMPLOYEE_COLUMNS: SheetColumn<EmployeeSheetRow>[] = [
  {
    header: 'Employee ID', aliases: ['employee code', 'emp id'], width: 16,
    value: (r) => r.employeeId ?? '',
    note: 'The match key. An ID already in use updates that employee; a new one is assigned to the row\'s employee. Unique per organization.',
  },
  {
    header: 'Employee name', aliases: ['name', 'full name'], width: 24,
    value: (r) => r.name ?? '',
    note: 'The person\'s full name, as it reads everywhere in the app.',
  },
  {
    header: 'Username', aliases: ['login'], width: 18,
    value: (r) => r.username,
    note: 'Required when adding. Also the fallback match key for a row with no employee ID. Cannot be changed by import.',
  },
  {
    header: 'Email', width: 26,
    value: (r) => r.email,
    note: 'Required when adding. Must be unique across the platform.',
  },
  {
    header: 'Password', width: 18,
    note: 'Required when adding, at least 8 characters. Always blank in an export; a blank cell on an existing employee leaves their password alone.',
  },
  {
    header: 'Department', width: 20,
    value: (r) => r.department ?? '',
    note: 'Free text. Values on the Department option list are what the form offers.',
  },
  {
    header: 'Designation', aliases: ['job title', 'title'], width: 20,
    value: (r) => r.designation ?? '',
    note: 'Free text. Values on the Designation option list are what the form offers.',
  },
  { header: 'Phone', aliases: ['mobile', 'contact number'], width: 16, value: (r) => r.phone ?? '', note: 'Free text.' },
  {
    header: 'Manager', aliases: ['reports to', 'manager name'], width: 22,
    value: (r) => r.manager?.name || r.manager?.username || '',
    note: 'The manager\'s employee ID, name or username. They must be a staff user carrying the Manager role. Use "none" to clear a manager.',
  },
  {
    header: 'Status', aliases: ['active'], width: 12,
    value: (r) => (r.isActive ? 'Active' : 'Inactive'),
    note: 'Active or Inactive. Blank keeps the current status (Active on a new employee). Deactivating an employee who still holds assets raises the exit-clearance banner on their screen.',
  },

  // Read-back context: roles are set on the Users screen, and an allocation is
  // issued on the allocation grid, where the availability rule is enforced.
  { header: 'Assets held', width: 12, value: (r) => r.assetsHeld ?? 0, exportOnly: true },
];

export const EMPLOYEE_IMPORT_NOTES = [
  'Fill one row per person. The first row must stay as the headers.',
  'An employee is a staff login, so a new row needs a username, an email and a password of at least 8 characters.',
  'A row whose Employee ID (or, failing that, Username) already exists updates that employee instead of adding one.',
  'On an update, a blank cell leaves the stored value alone — clear a field on the employee screen instead.',
  'Roles are assigned on the Users screen, and assets are allocated on the employee or asset screen; neither is set here.',
];
