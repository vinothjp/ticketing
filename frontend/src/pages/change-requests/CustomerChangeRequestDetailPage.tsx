import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

// Only the fields a customer needs to make an approval decision (no internal
// development/testing/transport detail).
interface CR {
  id: string;
  crNumber: string;
  title: string;
  description?: string | null;
  priority?: string | null;
  crType?: string | null;
  crCategory?: string | null;
  moduleName?: string | null;
  featureName?: string | null;
  requirementDetails?: string | null;
  objective?: string | null;
  reasonForCr?: string | null;
  benefitToCustomer?: string | null;
  estimatedHours?: number | string | null;
  complexity?: string | null;
  crStartDate?: string | null;
  crEndDate?: string | null;
  targetReleaseDate?: string | null;
  expectedGoLiveDate?: string | null;
  createdByName?: string | null;
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  approvalReason?: string | null;
}

const fmtDate = (v?: string | null) => (v ? new Date(v).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
const badge = (s: string) =>
  s === 'PENDING' ? { label: 'Awaiting your approval', cls: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30' }
  : s === 'APPROVED' ? { label: 'Approved', cls: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30' }
  : { label: 'Rejected', cls: 'bg-destructive/15 text-destructive border-destructive/30' };

function Row({ label, value }: { label: string; value?: string | number | null }) {
  const v = value === 0 || value ? String(value) : '';
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="whitespace-pre-wrap text-sm text-foreground">{v || '—'}</div>
    </div>
  );
}

export default function CustomerChangeRequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState('');

  const { data: cr, isLoading } = useQuery<CR>({
    queryKey: ['my-change-requests', id],
    queryFn: async () => (await api.get(`/api/my-change-requests/${id}`)).data,
    enabled: !!id,
  });
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['my-change-requests'] });
    qc.invalidateQueries({ queryKey: ['notifications'] });
  };
  const approve = useMutation({
    mutationFn: () => api.post(`/api/my-change-requests/${id}/approve`),
    onSuccess: () => { invalidate(); toast.success('Change request approved'); navigate('/my-change-requests'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  });
  const reject = useMutation({
    mutationFn: () => api.post(`/api/my-change-requests/${id}/reject`, { reason: reason.trim() }),
    onSuccess: () => { invalidate(); toast.success('Change request rejected'); navigate('/my-change-requests'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  });

  if (isLoading || !cr) return <p className="text-muted-foreground">Loading…</p>;
  const b = badge(cr.approvalStatus);

  return (
    <div className="max-w-4xl">
      <Button variant="ghost" size="sm" className="mb-3 -ml-2" onClick={() => navigate('/my-change-requests')}>
        <ArrowLeft className="size-4" /> All change requests
      </Button>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted-foreground">{cr.crNumber}</span>
          <h1 className="text-xl font-bold text-foreground">{cr.title}</h1>
          <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${b.cls}`}>{b.label}</span>
        </div>
        {cr.approvalStatus === 'PENDING' && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { setRejectOpen(true); setReason(''); }}>Reject</Button>
            <Button onClick={() => approve.mutate()} disabled={approve.isPending}>Approve</Button>
          </div>
        )}
      </div>

      {cr.approvalStatus === 'REJECTED' && cr.approvalReason && (
        <div className="mb-5 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm">
          <span className="text-muted-foreground">Your rejection reason: </span>{cr.approvalReason}
        </div>
      )}

      <div className="space-y-4">
        <Card>
          <CardHeader><CardTitle className="text-sm">Overview</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 pb-5 sm:grid-cols-3">
            <Row label="Priority" value={cr.priority} />
            <Row label="Type" value={cr.crType} />
            <Row label="Category" value={cr.crCategory} />
            <Row label="Module" value={cr.moduleName} />
            <Row label="Feature" value={cr.featureName} />
            <Row label="Raised by" value={cr.createdByName} />
            <div className="sm:col-span-3"><Row label="Description" value={cr.description} /></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Business need</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 pb-5 sm:grid-cols-2">
            <Row label="Requirement details" value={cr.requirementDetails} />
            <Row label="Objective" value={cr.objective} />
            <Row label="Reason for the change" value={cr.reasonForCr} />
            <Row label="Benefit to you" value={cr.benefitToCustomer} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Effort &amp; schedule</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 pb-5 sm:grid-cols-3">
            <Row label="Estimated hours" value={cr.estimatedHours ?? undefined} />
            <Row label="Complexity" value={cr.complexity} />
            <div className="hidden sm:block" />
            <Row label="Start date" value={fmtDate(cr.crStartDate)} />
            <Row label="End date" value={fmtDate(cr.crEndDate)} />
            <Row label="Target release" value={fmtDate(cr.targetReleaseDate)} />
            <Row label="Expected go-live" value={fmtDate(cr.expectedGoLiveDate)} />
          </CardContent>
        </Card>
      </div>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject change request</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">The provider will be notified with your reason.</p>
          <Textarea rows={4} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this change request being rejected?" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>Cancel</Button>
            <Button variant="destructive" disabled={!reason.trim() || reject.isPending} onClick={() => reject.mutate()}>Reject &amp; notify</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
