import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { GitPullRequestArrow, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import api from '../../lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

interface CR {
  id: string;
  crNumber: string;
  title: string;
  description?: string | null;
  priority?: string | null;
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  approvalReason?: string | null;
  createdByName?: string | null;
  createdAt: string;
}

// A clickable summary tile that filters the list.
function StatCard({ label, value, active, onClick }: { label: string; value: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('min-w-28 rounded-lg border px-4 py-3 text-left transition-colors', active ? 'border-primary bg-primary/5' : 'hover:bg-muted/50')}
    >
      <div className="text-2xl font-bold text-foreground">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </button>
  );
}

const badge = (s: string) =>
  s === 'PENDING' ? { label: 'Awaiting your approval', cls: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30' }
  : s === 'APPROVED' ? { label: 'Approved', cls: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30' }
  : { label: 'Rejected', cls: 'bg-destructive/15 text-destructive border-destructive/30' };

export default function CustomerChangeRequestsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [rejectFor, setRejectFor] = useState<CR | null>(null);
  const [reason, setReason] = useState('');
  const [filter, setFilter] = useState<'all' | 'PENDING' | 'APPROVED' | 'REJECTED'>('all');

  const { data: crs = [], isLoading } = useQuery<CR[]>({
    queryKey: ['my-change-requests'],
    queryFn: async () => (await api.get('/api/my-change-requests')).data,
  });
  const counts = useMemo(() => {
    const c = { total: crs.length, PENDING: 0, APPROVED: 0, REJECTED: 0 } as Record<string, number>;
    for (const cr of crs) c[cr.approvalStatus] = (c[cr.approvalStatus] ?? 0) + 1;
    return c;
  }, [crs]);
  const visible = filter === 'all' ? crs : crs.filter((cr) => cr.approvalStatus === filter);
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['my-change-requests'] });
    qc.invalidateQueries({ queryKey: ['notifications'] });
  };

  const approve = useMutation({
    mutationFn: (id: string) => api.post(`/api/my-change-requests/${id}/approve`),
    onSuccess: () => { invalidate(); toast.success('Change request approved'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  });
  const reject = useMutation({
    mutationFn: (v: { id: string; reason: string }) => api.post(`/api/my-change-requests/${v.id}/reject`, { reason: v.reason }),
    onSuccess: () => { invalidate(); setRejectFor(null); setReason(''); toast.success('Change request rejected'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  });

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-foreground">Change Management</h1>
        <p className="text-sm text-muted-foreground">Review and approve change requests raised by your provider.</p>
      </div>

      {/* Summary tiles (click to filter) */}
      <div className="mb-6 flex flex-wrap gap-3">
        <StatCard label="Total" value={counts.total} active={filter === 'all'} onClick={() => setFilter('all')} />
        <StatCard label="Awaiting approval" value={counts.PENDING} active={filter === 'PENDING'} onClick={() => setFilter('PENDING')} />
        <StatCard label="Approved" value={counts.APPROVED} active={filter === 'APPROVED'} onClick={() => setFilter('APPROVED')} />
        <StatCard label="Rejected" value={counts.REJECTED} active={filter === 'REJECTED'} onClick={() => setFilter('REJECTED')} />
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-12 text-center">
          <GitPullRequestArrow className="size-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {crs.length === 0 ? 'No change requests to review.' : 'None in this view.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {visible.map((cr) => {
            const b = badge(cr.approvalStatus);
            return (
              <Card key={cr.id} className="transition-colors hover:border-primary/40">
                <CardContent className="space-y-3 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    {/* Clicking the CR opens the full details to review before deciding. */}
                    <button className="min-w-0 flex-1 text-left" onClick={() => navigate(`/my-change-requests/${cr.id}`)}>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{cr.crNumber}</span>
                        <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${b.cls}`}>{b.label}</span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-1 text-base font-semibold text-foreground hover:underline">
                        {cr.title} <ChevronRight className="size-4 text-muted-foreground" />
                      </div>
                      {cr.createdByName && <div className="text-xs text-muted-foreground">Raised by {cr.createdByName}</div>}
                    </button>
                    {cr.approvalStatus === 'PENDING' && (
                      <div className="flex shrink-0 gap-2">
                        <Button size="sm" variant="outline" onClick={() => { setRejectFor(cr); setReason(''); }}>Reject</Button>
                        <Button size="sm" onClick={() => approve.mutate(cr.id)} disabled={approve.isPending}>Approve</Button>
                      </div>
                    )}
                  </div>
                  {cr.description && <p className="line-clamp-2 whitespace-pre-wrap text-sm text-muted-foreground">{cr.description}</p>}
                  {cr.approvalStatus === 'REJECTED' && cr.approvalReason && (
                    <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-foreground">
                      <span className="text-muted-foreground">Your reason: </span>{cr.approvalReason}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!rejectFor} onOpenChange={(o) => !o && setRejectFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject change request</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">The provider will be notified with your reason.</p>
          <Textarea rows={4} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this change request being rejected?" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectFor(null)}>Cancel</Button>
            <Button variant="destructive" disabled={!reason.trim() || reject.isPending}
              onClick={() => rejectFor && reject.mutate({ id: rejectFor.id, reason: reason.trim() })}>
              Reject &amp; notify
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
