import { SheetColumn } from '../lib/spreadsheet';

/**
 * The Users screen's import sheet — the New User form as columns, plus Roles.
 *
 * Deliberately separate from `employee-sheet.ts`: the Users screen deals in
 * logins and roles, the Employee Master in the employee record (ID, department,
 * manager), and each screen's template carries only its own fields.
 *
 * Import only, and add-only — the Users screen offers no export, so there is no
 * `value`, and a row naming an existing username is refused, never an update.
 */
export const USER_COLUMNS: SheetColumn[] = [
  {
    header: 'Username', aliases: ['login', 'user name'], width: 18,
    note: 'Required. Must not already exist — a username already taken is refused, never updated. Edit existing users on the Users screen. Capitals count: "Agent1" and "agent1" are different usernames.',
  },
  {
    header: 'Name', aliases: ['full name', 'employee name'], width: 24,
    note: 'The person\'s full name, as it reads everywhere in the app.',
  },
  {
    header: 'Email', width: 26,
    note: 'Required. Must not already be in use.',
  },
  {
    header: 'Password', width: 18,
    note: 'Required, at least 8 characters.',
  },
  {
    header: 'Roles', aliases: ['role', 'user role'], width: 20,
    note: 'Role names from the Roles screen, several separated by commas — e.g. "Viewer" for an agent, "Viewer, Manager" for a lead, "Admin". Blank gives Viewer. Manager is always held with Viewer, so Viewer is added if it is missing.',
  },
  {
    header: 'Status', aliases: ['active'], width: 12,
    note: 'Active or Inactive. Blank means Active.',
  },
];

export const USER_IMPORT_NOTES = [
  'Fill one row per new user. The first row must stay as the headers.',
  'Every row needs a username, an email and a password of at least 8 characters.',
  'This sheet only adds users. A row whose username or email already exists is skipped with a reason — change existing users on the Users screen.',
  'A user with a blank Roles cell becomes a Viewer (the base staff role), so every imported login can use the app straight away.',
  'Employee details (Employee ID, department, designation, phone, manager) are imported from the Employee Master screen, not here.',
];

/** The base staff role every internal login holds — what a blank Roles cell gives a new user. */
export const BASE_STAFF_ROLE = 'Viewer';
