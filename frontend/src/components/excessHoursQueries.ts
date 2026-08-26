import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
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

/** Timestamp format shared by every excess-hours surface. */
export const stampExcess = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

/**
 * The live request for one pool. There is one row per pool per period
 * (`@@unique([scope, ownerId, periodLabel])`) and the list arrives newest-first,
 * so the head of the owner's rows is the one that governs right now.
 */
export const latestExcessFor = (all: ExcessRequest[], ownerId: string | undefined) =>
  (ownerId ? all.find((r) => r.ownerId === ownerId) : undefined) ?? null;

/**
 * Approve or reject a request. The decision is a *permission* — nothing is
 * booked by it; approving just unlocks over-cap logging for that pool + period.
 */
export function useDecideExcess(companyId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) =>
      api.post(`/api/customer-companies/excess-requests/${id}/${approve ? 'approve' : 'reject'}`, {}),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['excess-requests', companyId] });
      qc.invalidateQueries({ queryKey: ['my-excess-requests'] });
      toast.success(v.approve ? 'Excess hours approved' : 'Request declined');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error deciding request'),
  });
}
