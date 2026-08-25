import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ShieldAlert, Check, X, ChevronDown, ChevronRight } from 'lucide-react';
import api from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { useExcessRequests, useMyExcessRequests } from './excessHoursQueries';

const stamp = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

const statusVariant = (s: string) =>
  s === 'APPROVED' ? 'success' : s === 'REJECTED' ? 'destructive' : 'warning';

/**
 * Requests to log time beyond a client's support-hours allowance, decided here.
 *
 * The request is a **permission, not a time entry** — approving unlocks over-cap
 * logging on that pool for the period, and the consultant then logs their hours
 * normally. Nothing is booked by the decision itself.
 *
 * `ownerId` scopes the panel to one pool, so the product screen shows only that
 * product's request and the customer-contract screen only the shared one. Omit it
 * to show every request on the client.
 */
export default function ExcessHoursApprovals({
  companyId,
  ownerId,
}: {
  companyId: string;
  ownerId?: string;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = !!user?.roles.includes('Admin');
  const [note, setNote] = useState<Record<string, string>>({});

  const { data: all = [] } = useExcessRequests(companyId);
  const requests = ownerId ? all.filter((r) => r.ownerId === ownerId) : all;
  const pending = requests.filter((r) => r.status === 'PENDING').length;
  // Open when something actually needs deciding; a settled history stays folded
  // away so it costs a line rather than a screenful. `pending` keys it, so a
  // request arriving on a page left open unfolds the panel by itself.
  const [open, setOpen] = useState(pending > 0);
  // Adjust during render rather than in an effect — an effect here fires a second
  // render pass just to reopen the panel, and React's own guidance is to compare
  // against the previous value instead.
  const [seenPending, setSeenPending] = useState(pending);
  if (seenPending !== pending) {
    setSeenPending(pending);
    setOpen(pending > 0);
  }

  const decide = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) =>
      api.post(`/api/customer-companies/excess-requests/${id}/${approve ? 'approve' : 'reject'}`, {
        note: note[id]?.trim() || undefined,
      }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['excess-requests', companyId] });
      qc.invalidateQueries({ queryKey: ['my-excess-requests'] });
      toast.success(v.approve ? 'Excess hours approved' : 'Request declined');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error deciding request'),
  });

  if (requests.length === 0) return null;

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <button
          type="button"
          className="flex w-full items-center gap-2 text-left text-sm font-medium text-foreground"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <ShieldAlert className="size-4 text-muted-foreground" />
          Excess support-hours requests
          <span className="text-xs text-muted-foreground">{requests.length}</span>
          {pending > 0 && (
            <Badge variant="warning">{pending} awaiting</Badge>
          )}
          {open
            ? <ChevronDown className="size-4 text-muted-foreground" />
            : <ChevronRight className="size-4 text-muted-foreground" />}
        </button>

        {open && requests.map((r) => {
          // Only the named approver decides it; a tenant Admin may step in. Mirrors
          // the backend rule, so a consultant who can merely see this client's page
          // gets no buttons rather than a 403.
          const mayDecide =
            r.status === 'PENDING' && (isAdmin || r.approverUserId === user?.id);
          return (
            <div key={r.id} className="space-y-2 rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={statusVariant(r.status)}>{r.status.toLowerCase()}</Badge>
                <span className="text-sm font-medium text-foreground">
                  {r.productName ?? 'Shared customer contract'}
                </span>
                {r.periodLabel !== 'ALL' && (
                  <span className="text-xs text-muted-foreground">for {r.periodLabel}</span>
                )}
              </div>

              <div className="text-xs text-muted-foreground">
                {r.requestedByName ?? 'A consultant'} asked to log beyond the{' '}
                <span className="font-medium text-foreground">{r.allocated} h</span> allowance
                {' '}({Number(r.usedAtRequest)} h already used) · {stamp(r.createdAt)}
              </div>

              {r.status !== 'PENDING' && (
                <div className="text-xs text-muted-foreground">
                  {r.status === 'APPROVED' ? 'Approved' : 'Declined'} by{' '}
                  {r.approverName ?? 'the approver'}
                  {r.decidedAt ? ` · ${stamp(r.decidedAt)}` : ''}
                  {r.decisionNote ? ` · ${r.decisionNote}` : ''}
                </div>
              )}

              {mayDecide && (
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    className="h-8 flex-1 min-w-48"
                    placeholder="Note (optional)"
                    value={note[r.id] ?? ''}
                    onChange={(e) => setNote((n) => ({ ...n, [r.id]: e.target.value }))}
                  />
                  <Button
                    size="sm"
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ id: r.id, approve: true })}
                  >
                    <Check className="size-4" /> Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ id: r.id, approve: false })}
                  >
                    <X className="size-4" /> Reject
                  </Button>
                </div>
              )}
              {r.status === 'PENDING' && !mayDecide && (
                <div className="text-xs text-muted-foreground">
                  Awaiting {r.approverName ?? 'the approver'}.
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

/** Banner listing the requests this user must decide, each linking to its pool. */
export function MyExcessApprovals() {
  const navigate = useNavigate();
  const { data: mine = [] } = useMyExcessRequests();
  if (mine.length === 0) return null;

  return (
    <div className="mb-4 space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/20">
      <div className="flex items-center gap-2 text-sm font-medium text-amber-800 dark:text-amber-300">
        <ShieldAlert className="size-4" />
        {mine.length} excess support-hours {mine.length === 1 ? 'request needs' : 'requests need'} your approval
      </div>
      {mine.map((r) => (
        <div key={r.id} className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-foreground">
            {r.company?.name ?? 'A client'} · {r.productName ?? 'shared contract'}
          </span>
          <span className="text-xs text-muted-foreground">
            {r.requestedByName ?? 'A consultant'} asked to log beyond {r.allocated} h
          </span>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            onClick={() =>
              navigate(
                r.scope === 'PRODUCT'
                  ? `/admin/clients/${r.customerCompanyId}/products/${r.ownerId}`
                  : `/admin/clients/${r.customerCompanyId}`,
              )
            }
          >
            Review
          </Button>
        </div>
      ))}
    </div>
  );
}
