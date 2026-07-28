import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import api from '../../../lib/api';
import { useAuth } from '../../../context/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

interface Approval {
  id: string;
  approverUserId: string;
  approverName?: string | null;
  status: string;
  comment?: string | null;
  requestedByName?: string | null;
  requestedAt: string;
  decidedAt?: string | null;
}
interface UserOption { id: string; username: string; }

const STATUS_VARIANT: Record<string, 'secondary' | 'success' | 'destructive'> = {
  PENDING: 'secondary', APPROVED: 'success', REJECTED: 'destructive', CANCELLED: 'secondary',
};

export default function ApprovalsTab({ ticketId }: { ticketId: string }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [approver, setApprover] = useState('');
  const [comment, setComment] = useState('');

  const { data: approvals = [] } = useQuery<Approval[]>({
    queryKey: ['ticket-approvals', ticketId],
    queryFn: async () => (await api.get(`/api/tickets/${ticketId}/approvals`)).data,
  });
  const { data: users = [] } = useQuery<UserOption[]>({
    queryKey: ['users'],
    queryFn: async () => (await api.get('/api/users')).data,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['ticket-approvals', ticketId] });
    qc.invalidateQueries({ queryKey: ['ticket-activity', ticketId] });
  };
  const request = useMutation({
    mutationFn: () => api.post(`/api/tickets/${ticketId}/approvals`, { approverUserId: approver, comment: comment || undefined }),
    onSuccess: () => { invalidate(); setOpen(false); setApprover(''); setComment(''); toast.success('Approval requested'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error requesting approval'),
  });
  const decide = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'APPROVED' | 'REJECTED' }) =>
      api.post(`/api/approvals/${id}/decision`, { status }),
    onSuccess: () => { invalidate(); toast.success('Decision recorded'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error recording decision'),
  });

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setOpen(true)}><Plus className="size-4" /> Request approval</Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Request approval</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Approver</label>
              <Select value={approver || undefined} onValueChange={setApprover}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Select approver..." /></SelectTrigger>
                <SelectContent>
                  {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.username}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Note (optional)</label>
              <Textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => request.mutate()} disabled={!approver || request.isPending}>Request</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {approvals.length === 0 ? (
        <p className="text-sm text-muted-foreground">No approvals requested.</p>
      ) : (
        <div className="divide-y border-y">
          {approvals.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium text-foreground">{a.approverName ?? 'Approver'}</span>
                  <Badge variant={STATUS_VARIANT[a.status] ?? 'secondary'}>{a.status}</Badge>
                </div>
                <div className="text-xs text-muted-foreground">
                  Requested by {a.requestedByName ?? '—'} · {new Date(a.requestedAt).toLocaleDateString()}
                  {a.comment ? ` · "${a.comment}"` : ''}
                </div>
              </div>
              {a.status === 'PENDING' && user?.id === a.approverUserId && (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => decide.mutate({ id: a.id, status: 'APPROVED' })}>Approve</Button>
                  <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => decide.mutate({ id: a.id, status: 'REJECTED' })}>Reject</Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
