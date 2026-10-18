// Shared types for the cross-project weekly Timesheet page.

// A work item time can be logged against: one of the project's leaf tasks or
// subtasks, in WBS order, with its live WBS code and the top-level item above it.
export interface LoggableTask {
  id: string;
  code: string;
  title: string;
  phase: string | null;
}

export interface ProjectOption {
  id: string;
  name: string;
  projectNumber: string;
  customerName: string | null;
  startDate: string | null;       // yyyy-mm-dd — no time is logged outside the project's run
  endDate: string | null;
  tasks: LoggableTask[];           // the Activity choices for a row on this project
}

// A row as returned by the server (existing entries collapsed by project+activity).
export interface WeekRow {
  projectId: string;
  taskId: string | null;          // null only on an entry from before rows named a task
  activity: string;
  workPerformed: string | null;
  status: string;                 // DRAFT | SUBMITTED | APPROVED | REJECTED
  days: Record<string, number>;   // isoDate -> hours
}

export interface WeekResponse {
  weekStart: string;
  days: string[];                 // 7 ISO day keys (Mon..Sun)
  consultant: { id: string; username: string | null };
  documentNumber: string;
  documentDate: string;
  projects: ProjectOption[];
  rows: WeekRow[];
}

// Editable client-side row (status carried through so we can badge/lock it).
export interface GridRow {
  projectId: string;
  taskId: string | null;
  activity: string;
  workPerformed: string;
  status: string;
  days: Record<string, number>;
}

export const projectLabel = (p?: ProjectOption) =>
  p ? `${p.customerName ? `${p.customerName} : ` : ''}${p.name}` : '';

// Monday (local) of the week containing `date`, formatted yyyy-mm-dd.
export function weekStartOf(date: Date): string {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay();                 // 0=Sun..6=Sat
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function addDays(isoDate: string, n: number): string {
  const d = new Date(`${isoDate}T00:00:00`);
  d.setDate(d.getDate() + n);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
// Column header parts for an ISO day key: weekday label + day-of-month.
export function dayHeader(isoDate: string, index: number) {
  const d = new Date(`${isoDate}T00:00:00`);
  return { label: WEEKDAYS[index] ?? '', num: d.getDate() };
}

export const statusVariant = (s: string): 'success' | 'destructive' | 'secondary' | 'outline' =>
  s === 'APPROVED' ? 'success' : s === 'REJECTED' ? 'destructive' : s === 'SUBMITTED' ? 'secondary' : 'outline';
