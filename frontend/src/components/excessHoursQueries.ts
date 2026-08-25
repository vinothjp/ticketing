import { useQuery } from '@tanstack/react-query';
import api from '../lib/api';

export interface ExcessRequest {
  id: string;
  scope: 'CONTRACT' | 'PRODUCT';
  ownerId: string;
  periodLabel: string;
  allocated: number;
  usedAtRequest: number | string;
  productName?: string | null;
  requestedByName?: string | null;
  approverUserId?: string | null;
  approverName?: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  decisionNote?: string | null;
  decidedAt?: string | null;
  createdAt: string;
}

export interface MyExcessRequest extends ExcessRequest {
  customerCompanyId: string;
  company?: { name: string } | null;
}

/** Every excess-hours request raised for one client, newest first. */
export function useExcessRequests(companyId: string | undefined) {
  return useQuery<ExcessRequest[]>({
    queryKey: ['excess-requests', companyId],
    queryFn: async () => (await api.get(`/api/customer-companies/${companyId}/excess-requests`)).data,
    enabled: !!companyId,
  });
}

/**
 * Requests waiting on *this* user, across every client.
 *
 * The per-client panel only helps someone already on the right screen. An
 * approver — often a consultant with no reason to browse clients — needs to find
 * what is waiting on them, so this drives the banner on the Clients list.
 */
export function useMyExcessRequests() {
  return useQuery<MyExcessRequest[]>({
    queryKey: ['my-excess-requests'],
    queryFn: async () => (await api.get('/api/customer-companies/excess-requests/mine')).data,
  });
}
