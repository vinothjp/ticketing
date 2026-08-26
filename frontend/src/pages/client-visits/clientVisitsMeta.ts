/**
 * Where a visit is *now*. Being rescheduled is two states, not one:
 * `RESCHEDULE_REQUESTED` is the consultant asking, waiting on a date from an
 * admin; once the admin sets one the visit is `PLANNED` again and the fact that
 * it slipped is carried by `rescheduleCount`, not by the status. Leaving it on
 * "Rescheduled" forever would hide that it is a normal upcoming visit again.
 */
export const VISIT_STATUSES = ['PLANNED', 'VISITED', 'RESCHEDULE_REQUESTED'] as const;
export const VISIT_STATUS_LABELS: Record<string, string> = {
  PLANNED: 'Planned',
  VISITED: 'Visited',
  RESCHEDULE_REQUESTED: 'Reschedule requested',
};

/** A visit is waiting on an admin to give it a new date. */
export const needsNewDate = (v: { status: string }) => v.status === 'RESCHEDULE_REQUESTED';

/**
 * A visit that has already been re-dated at least once — shown as an orange
 * "Rescheduled" marker beside its current status, not instead of it.
 */
export const wasRescheduled = (v: { status: string; rescheduleCount?: number }) =>
  !needsNewDate(v) && (v.rescheduleCount ?? 0) > 0;

export interface ClientVisit {
  id: string;
  visitNumber: string | null;
  visitDate: string;
  customerCompanyId: string;
  customerCompany?: { name: string };
  consultantId: string;
  consultantName: string | null;
  productId: string | null;
  productName: string | null;
  hours: number;
  purpose: string;
  notes: string | null;
  status: string;
  /** Times an admin has re-dated this visit after a consultant asked. */
  rescheduleCount?: number;
  ticketId: string | null;
  contractDeducted: boolean;
  createdAt: string;
}

export interface CustomerCompanyOption {
  id: string;
  name: string;
  /** Coverage model — PRODUCT makes the visit's product field mandatory. */
  contractScope?: 'PRODUCT' | 'CUSTOMER';
}

export interface UserOption {
  id: string;
  username: string;
  isActive?: boolean;
}

/** A product the customer has actually purchased (`:id/purchased-products`). */
export interface CustomerProductOption {
  id: string;
  productId: string;
  productName: string | null;
}

/** A consultant assigned to this customer (`:id/consultants`). */
export interface CustomerConsultantOption {
  id: string;
  userId: string;
  username: string | null;
  productId: string | null;
  isPrimary: boolean;
}

export interface TicketOption {
  id: string;
  ticketNumber: string;
  subject: string;
  customerCompanyId?: string | null;
}

export const statusVariant = (s: string): 'success' | 'destructive' | 'secondary' | 'outline' | 'warning' =>
  s === 'VISITED' ? 'success' : s === 'RESCHEDULE_REQUESTED' ? 'warning' : 'secondary';

/**
 * The status pill in the visits grid — the same bold, colour-coded treatment the
 * ticket task grid uses, so a column of statuses reads the same on both screens.
 * `statusVariant` above still serves the Badge-shaped callers (the report dialog
 * and the panel), so both live here rather than one replacing the other.
 */
export const statusPill = (s: string) =>
  s === 'VISITED' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
  : s === 'RESCHEDULE_REQUESTED' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
  : 'bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300';
