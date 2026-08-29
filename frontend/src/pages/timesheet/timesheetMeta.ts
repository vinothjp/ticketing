// Shared types for the cross-project weekly Timesheet page.

// The Activity list from the Excel spec ("21 Project Time Sheet.xlsx"), which
// seeds the tenant's `timesheetActivity` option list. The live list comes from
// the server (`WeekResponse.activities`, read off that option list); this array
// is only the fallback before the week has loaded.
export const ACTIVITIES = [
  'Blueprint',
  'System Configuration',
  'Unit Testing',
  'UAT',
  'Training',
  'Cut over',
  'PRD Deployment',
  'Go-Live Support',
] as const;

export interface ProjectOption {
  id: string;
  name: string;
  projectNumber: string;
  customerName: string | null;
}

// A row as returned by the server (existing entries collapsed by project+activity).
export interface WeekRow {
  projectId: string;
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
  activities: readonly string[];
  projects: ProjectOption[];
  rows: WeekRow[];
}

// Editable client-side row (status carried through so we can badge/lock it).
export interface GridRow {
  projectId: string;
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
