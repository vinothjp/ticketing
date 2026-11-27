import { useQuery } from '@tanstack/react-query';
import api from './api';

/**
 * Who a ticket is for, as every ticket screen shows it (client request): the
 * client company it was raised for — by the client or by staff on its behalf —
 * else, an internal ticket, "Internal Ticket / <service provider>".
 */
export const ticketSourceLabel = (companyName?: string | null, providerName?: string | null) =>
  companyName?.trim() || (providerName ? `Internal Ticket / ${providerName}` : 'Internal Ticket');

/** The service provider's own name — the header's `['my-client']` query and cache entry. */
export function useProviderName() {
  const { data } = useQuery<{ name: string } | null>({
    queryKey: ['my-client'],
    queryFn: async () => (await api.get('/api/auth/me/client')).data,
  });
  return data?.name ?? null;
}
