import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, ShieldCheck, Pencil, Trash2 } from 'lucide-react';
import api from '../../../lib/api';
import { useAuth } from '../../../context/AuthContext';
import { useConfirm } from '../../../hooks/useConfirm';
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

/**
 * `canManage` — a tenant Admin or the agent this ticket is assigned to. Editing
 * and withdrawing a request belongs to the side that *asked* for it, so the whole
 * Actions column is absent for everyone else, the named approver included: they
 * decide the request, they do not get to rewrite it. The server enforces the same
 * rule (ApprovalsService.loadManageable) — this only keeps dead controls off screen.
 */
export default function ApprovalsTab({ ticketId, canManage }: { ticketId: string; canManage: boolean }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { confirm, ConfirmDialog } = useConfirm();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Approval | null>(null);
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
  const closeDialog = () => { setOpen(false); setEditing(null); setApprover(''); setComment(''); };

  const request = useMutation({
    mutationFn: () => api.post(`/api/tickets/${ticketId}/approvals`, { approverUserId: approver, comment: comment || undefined }),
    onSuccess: () => { invalidate(); closeDialog(); toast.success('Approval requested'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error requesting approval'),
  });
  const save = useMutation({
    mutationFn: () => api.patch(`/api/approvals/${editing!.id}`, { approverUserId: approver, comment }),
    onSuccess: () => { invalidate(); closeDialog(); toast.success('Approval request updated'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error updating approval'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/approvals/${id}`),
    onSuccess: () => { invalidate(); toast.success('Approval request deleted'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error deleting approval'),
  });
  const decide = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'APPROVED' | 'REJECTED' }) =>
      api.post(`/api/approvals/${id}/decision`, { status }),
    onSuccess: () => { invalidate(); toast.success('Decision recorded'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error recording decision'),
  });

  const startEdit = (a: Approval) => {
    setEditing(a);
    setApprover(a.approverUserId);
    setComment(a.comment ?? '');
    setOpen(true);
  };
  const askDelete = async (a: Approval) => {
    const ok = await confirm({
      title: 'Delete approval request?',
      description: `The request to ${a.approverName ?? 'the approver'} will be removed from this ticket.`,
      confirmText: 'Delete',
      destructive: true,
    });
    if (ok) remove.mutate(a.id);
  };

  // Only the approver of a still-pending row can decide, so the Decision column is
  // dead weight for everyone else — mount it only when it has something to hold.
  const canDecideAny = approvals.some((a) => a.status === 'PENDING' && a.approverUserId === user?.id);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-1.5 text-base font-semibold text-foreground">
          <ShieldCheck className="size-4" /> Approvals requested on this ticket
        </h2>
        <Button size="sm" onClick={() => { setEditing(null); setApprover(''); setComment(''); setOpen(true); }}>
          <Plus className="size-4" /> Request approval
        </Button>
      </div>

      <Dialog open={open} onOpenChange={(o) => { if (!o) closeDialog(); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? 'Edit approval request' : 'Request approval'}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Approver</label>
              {/* Radix resets a controlled value it cannot match while the list loads — ignore the empty emission. */}
              <Select value={approver || undefined} onValueChange={(v) => { if (v) setApprover(v); }}>
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
            <Button variant="outline" onClick={closeDialog}>Cancel</Button>
            <Button
              onClick={() => (editing ? save.mutate() : request.mutate())}
              disabled={!approver || request.isPending || save.isPending}
            >
              {editing ? 'Save changes' : 'Request'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {approvals.length === 0 ? (
        <p className="text-sm text-muted-foreground">No approvals requested yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left">
                <th className="px-3 py-2 font-medium">Approver</th>
                <th className="whitespace-nowrap px-3 py-2 font-medium">Requested by</th>
                {/* Note takes whatever the fixed cells leave — the dates ride under
                    "Requested by" and Status rather than owning columns of their own. */}
                <th className="w-full px-3 py-2 font-medium">Note</th>
                <th className="whitespace-nowrap px-3 py-2 font-medium">Status</th>
                {canDecideAny && <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Decision</th>}
                {canManage && <th className="w-px px-3 py-2 text-right font-medium">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {approvals.map((a) => (
                <tr key={a.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="whitespace-nowrap px-3 py-2 font-medium text-foreground">{a.approverName ?? 'Approver'}</td>
                  <td className="whitespace-nowrap px-3 py-2 align-top">
                    <div>{a.requestedByName ?? '-'}</div>
                    <div className="text-xs text-muted-foreground">{new Date(a.requestedAt).toLocaleDateString()}</div>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <span className="block max-w-[24rem] truncate" title={a.comment ?? undefined}>{a.comment || '-'}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 align-top">
                    <Badge variant={STATUS_VARIANT[a.status] ?? 'secondary'}>{a.status}</Badge>
                    {a.decidedAt && (
                      <div className="mt-0.5 text-xs text-muted-foreground">{new Date(a.decidedAt).toLocaleDateString()}</div>
                    )}
                  </td>
                  {canDecideAny && (
                    <td className="px-3 py-2 text-right align-top">
                      {a.status === 'PENDING' && user?.id === a.approverUserId ? (
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate({ id: a.id, status: 'APPROVED' })}>Approve</Button>
                          <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" disabled={decide.isPending} onClick={() => decide.mutate({ id: a.id, status: 'REJECTED' })}>Reject</Button>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                  )}
                  {canManage && (
                    <td className="px-3 py-2 text-right align-top">
                      <div className="flex justify-end gap-1">
                        {/* A decided request is a record — only a pending one can still be rewritten. */}
                        {a.status === 'PENDING' && (
                          <Button size="icon" variant="ghost" title="Edit request" onClick={() => startEdit(a)}>
                            <Pencil className="size-4" />
                          </Button>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Delete request"
                          className="text-destructive hover:text-destructive"
                          disabled={remove.isPending}
                          onClick={() => askDelete(a)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {ConfirmDialog}
    </div>
  );
}
