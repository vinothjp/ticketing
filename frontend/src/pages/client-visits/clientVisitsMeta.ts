export const VISIT_STATUSES = ['PLANNED', 'VISITED', 'RESCHEDULED'] as const;
export const VISIT_STATUS_LABELS: Record<string, string> = {
  PLANNED: 'Planned',
  VISITED: 'Visited',
  RESCHEDULED: 'Rescheduled',
};

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
  ticketId: string | null;
  contractDeducted: boolean;
  createdAt: string;
}

export interface CustomerCompanyOption {
  id: string;
  name: string;
}

export interface UserOption {
  id: string;
  username: string;
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

export const statusVariant = (s: string): 'success' | 'destructive' | 'secondary' | 'outline' =>
  s === 'VISITED' ? 'success' : s === 'RESCHEDULED' ? 'outline' : 'secondary';
