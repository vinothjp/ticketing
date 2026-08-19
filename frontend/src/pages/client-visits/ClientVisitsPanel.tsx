import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, Plus } from 'lucide-react';
import api from '../../lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { ClientVisit } from './clientVisitsMeta';
import { VISIT_STATUS_LABELS, statusVariant } from './clientVisitsMeta';

interface Props {
  /** Server-side filter — any subset of customerCompanyId / productId / ticketId. */
  filter: Record<string, string | null | undefined>;
  title?: string;
  /** Values pre-filled on the "Log a visit" form. Defaults to `filter`. */
  prefill?: Record<string, string | null | undefined>;
  limit?: number;
}

/**
 * Client visits for one thing — a client, a purchased product, a ticket.
 * Dropped into those screens so a logged visit shows up where the work it
 * belongs to lives. Admin-only API, so only render it for admins.
 */
export function ClientVisitsPanel({ filter, title = 'Client visits', prefill, limit = 5 }: Props) {
  const navigate = useNavigate();
  const params = new URLSearchParams();
  Object.entries(filter).forEach(([k, v]) => { if (v) params.append(k, v); });
  const qs = params.toString();

  const { data: visits = [], isLoading } = useQuery<ClientVisit[]>({
    queryKey: ['client-visits', qs],
    queryFn: async () => (await api.get(`/api/client-visits?${qs}`)).data,
    enabled: !!qs,
  });

  const newParams = new URLSearchParams();
  Object.entries(prefill ?? filter).forEach(([k, v]) => { if (v) newParams.append(k, v); });

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-1.5 text-base font-semibold text-foreground">
          <ClipboardList className="size-4" /> {title}
        </h2>
        <div className="flex items-center gap-2">
          {visits.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => navigate(`/client-visits?${qs}`)}>View all</Button>
          )}
          <Button size="sm" onClick={() => navigate(`/client-visits/new?${newParams.toString()}`)}>
            <Plus className="size-3.5" /> Log a visit
          </Button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : visits.length === 0 ? (
        <p className="text-sm text-muted-foreground">No visits logged yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left">
                <th className="px-3 py-2 font-medium">Visit #</th>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Consultant</th>
                <th className="px-3 py-2 font-medium">Product</th>
                <th className="px-3 py-2 font-medium">Hours</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Purpose</th>
              </tr>
            </thead>
            <tbody>
              {visits.slice(0, limit).map((visit) => (
                <tr
                  key={visit.id}
                  onClick={() => navigate(`/client-visits/${visit.id}/edit`)}
                  className="cursor-pointer border-b last:border-0 hover:bg-muted/30"
                >
                  <td className="px-3 py-2">{visit.visitNumber || '-'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{new Date(visit.visitDate).toLocaleDateString()}</td>
                  <td className="px-3 py-2">{visit.consultantName}</td>
                  <td className="px-3 py-2">{visit.productName || '-'}</td>
                  <td className="px-3 py-2">{visit.hours}</td>
                  <td className="px-3 py-2">
                    <Badge variant={statusVariant(visit.status)}>{VISIT_STATUS_LABELS[visit.status]}</Badge>
                  </td>
                  <td className="px-3 py-2">
                    {visit.purpose.length > 50 ? `${visit.purpose.substring(0, 50)}…` : visit.purpose}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {visits.length > limit && (
            <div className="border-t px-3 py-2 text-xs text-muted-foreground">
              Showing {limit} of {visits.length} — use “View all” for the rest.
            </div>
          )}
        </div>
      )}
    </section>
  );
}
