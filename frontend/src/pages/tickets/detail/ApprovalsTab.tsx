import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, ShieldCheck, Pencil, Trash2 } from 'lucide-react';
import api from '../../../lib/api';
import { useAuth } from '../../../context/AuthContext';
import { useConfirm } from '../../../hooks/useConfirm';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useDateFormat } from '@/lib/dateFormat';

interface Approval {
  id: string;
  approverUserId: string;
  approverName?: string | null;
  status: string;
  comment?: string | null;
  requestedByName?: string | null;
  requestedAt: string;
  decidedAt?: string | null;
  assetId?: string | null;
  assetCode?: string | null;
  assetName?: string | null;
  assetType?: string | null;
}
interface UserOption {
  id: string;
  username: string;
  name?: string | null;
  managerId?: string | null;
}
interface AssetOption { id: string; assetId: string; assetName: string; assetType?: string | null }

const STATUS_VARIANT: Record<string, 'secondary' | 'success' | 'destructive'> = {
  PENDING: 'secondary', APPROVED: 'success', REJECTED: 'destructive', CANCELLED: 'secondary',
};

/** Radix cannot hold an empty SelectItem value, so "no asset" needs a sentinel. */
const NO_ASSET = '__none__';

const personName = (u?: { name?: string | null; username?: string } | null) =>
  u?.name || u?.username || '';

/**
 * Asset requests on a ticket. The row asks a named approver for a specific
 * asset; approving it issues that asset to whoever raised the request, as an
 * ISSUED allocation on their Employee Master screen (`ApprovalsService.decide`).
 * A request with no asset is still a plain sign-off, which is what keeps every
 * approval raised before this flow existed working.
 *
 * `canManage` — a tenant Admin or the agent this ticket is assigned to. Editing
 * and withdrawing a request belongs to the side that *asked* for it, so the whole
 * Actions column is absent for everyone else, the named approver included: they
 * decide the request, they do not get to rewrite it. The server enforces the same
 * rule (ApprovalsService.loadManageable) — this only keeps dead controls off screen.
 */
export default function ApprovalsTab({ ticketId, canManage }: { ticketId: string; canManage: boolean }) {
  const { fmtDate } = useDateFormat();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { confirm, ConfirmDialog } = useConfirm();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Approval | null>(null);
  const [approver, setApprover] = useState('');
  const [assetId, setAssetId] = useState(NO_ASSET);
  const [assetType, setAssetType] = useState('');
  const [comment, setComment] = useState('');

  const { data: approvals = [] } = useQuery<Approval[]>({
    queryKey: ['ticket-approvals', ticketId],
    queryFn: async () => (await api.get(`/api/tickets/${ticketId}/approvals`)).data,
  });
  const { data: users = [] } = useQuery<UserOption[]>({
    queryKey: ['users'],
    queryFn: async () => (await api.get('/api/users')).data,
  });
  // Only assets nobody currently holds can be requested. Fetched while the
  // dialog is open so the list is current — one may have gone out meanwhile.
  const { data: freeAssets = [] } = useQuery<AssetOption[]>({
    queryKey: ['assets', 'available'],
    queryFn: async () => (await api.get('/api/assets', { params: { available: true } })).data,
    enabled: open,
  });

  const me = users.find((u) => u.id === user?.id);

  // An asset request goes to the requester's manager by default — that is what
  // the manager field on Employee Master is for. Still free to change.
  useEffect(() => {
    if (open && !editing && !approver && me?.managerId) setApprover(me.managerId);
  }, [open, editing, approver, me?.managerId]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['ticket-approvals', ticketId] });
    qc.invalidateQueries({ queryKey: ['ticket-activity', ticketId] });
    qc.invalidateQueries({ queryKey: ['assets'] });
    qc.invalidateQueries({ queryKey: ['asset-allocations'] });
  };
  const closeDialog = () => {
    setOpen(false); setEditing(null); setApprover('');
    setAssetId(NO_ASSET); setAssetType(''); setComment('');
  };

  const payload = () => ({
    approverUserId: approver,
    comment: comment || undefined,
    assetId: assetId === NO_ASSET ? null : assetId,
    assetType: assetType.trim() || null,
  });

  const request = useMutation({
    mutationFn: () => {
      const { assetId: id, ...rest } = payload();
      // POST takes an optional asset; omit rather than send null on a plain
      // sign-off, so the DTO's @IsNotEmpty on assetId is never tripped.
      return api.post(`/api/tickets/${ticketId}/approvals`, id ? { ...rest, assetId: id } : rest);
    },
    onSuccess: () => { invalidate(); closeDialog(); toast.success('Asset request raised'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error raising the request'),
  });
  const save = useMutation({
    mutationFn: () => api.patch(`/api/approvals/${editing!.id}`, payload()),
    onSuccess: () => { invalidate(); closeDialog(); toast.success('Request updated'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error updating the request'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/approvals/${id}`),
    onSuccess: () => { invalidate(); toast.success('Request withdrawn'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error withdrawing the request'),
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
    setAssetId(a.assetId ?? NO_ASSET);
    setAssetType(a.assetType ?? '');
    setComment(a.comment ?? '');
    setOpen(true);
  };
  const askDelete = async (a: Approval) => {
    const ok = await confirm({
      title: 'Withdraw this request?',
      description: `The request to ${a.approverName ?? 'the approver'}${a.assetCode ? ` for ${a.assetCode}` : ''} will be removed from this ticket.`,
      confirmText: 'Withdraw',
      destructive: true,
    });
    if (ok) remove.mutate(a.id);
  };

  /**
   * What the asset picker offers: the no-asset sentinel, then every free unit —
   * plus, while editing, the unit this request already names even if it has since
   * been taken, or the field would render empty and a save would silently drop it.
   */
  const assetOptions: ComboboxOption[] = [
    { value: NO_ASSET, label: 'No asset — approval only' },
    ...freeAssets.map((a) => ({
      value: a.id,
      label: `${a.assetId} — ${a.assetName}`,
      hint: a.assetType ?? null,
    })),
    ...(editing?.assetId && !freeAssets.some((a) => a.id === editing.assetId)
      ? [{
          value: editing.assetId,
          label: `${editing.assetCode ?? ''} — ${editing.assetName ?? ''}`.trim(),
          hint: 'currently requested',
        }]
      : []),
  ];

  // Picking an asset fills in its type; the admin can still override it.
  const pickAsset = (v: string) => {
    if (!v) return;
    setAssetId(v);
    const chosen = freeAssets.find((a) => a.id === v);
    if (chosen?.assetType) setAssetType(chosen.assetType);
  };

  // Only the approver of a still-pending row can decide, so the Decision column is
  // dead weight for everyone else — mount it only when it has something to hold.
  const canDecideAny = approvals.some((a) => a.status === 'PENDING' && a.approverUserId === user?.id);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-1.5 text-base font-semibold text-foreground">
          <ShieldCheck className="size-4" /> Asset requests on this ticket
        </h2>
        <Button size="sm" onClick={() => { setEditing(null); setApprover(''); setAssetId(NO_ASSET); setAssetType(''); setComment(''); setOpen(true); }}>
          <Plus className="size-4" /> Request asset
        </Button>
      </div>

      <Dialog open={open} onOpenChange={(o) => { if (!o) closeDialog(); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? 'Edit asset request' : 'Request asset'}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Asset</label>
              {/* Only what is free is offered; the server refuses a held asset
                  anyway, naming whoever has it. A register runs to hundreds of
                  units, so the picker is a combobox: click for the whole list,
                  type to narrow it by code, name or type. */}
              <Combobox
                value={assetId}
                options={assetOptions}
                onChange={pickAsset}
                placeholder="Select or type an asset code…"
                emptyText="No free asset matches that"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Asset type</label>
              <Input value={assetType} onChange={(e) => setAssetType(e.target.value)} placeholder="Laptop" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Approver</label>
              {/* Radix resets a controlled value it cannot match while the list loads — ignore the empty emission. */}
              <Select value={approver || undefined} onValueChange={(v) => { if (v) setApprover(v); }}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Select approver..." /></SelectTrigger>
                <SelectContent>
                  {users.map((u) => <SelectItem key={u.id} value={u.id}>{personName(u) || u.username}</SelectItem>)}
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
        <p className="text-sm text-muted-foreground">No asset requests on this ticket yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left">
                <th className="whitespace-nowrap px-3 py-2 font-medium">Asset</th>
                <th className="whitespace-nowrap px-3 py-2 font-medium">Asset type</th>
                <th className="whitespace-nowrap px-3 py-2 font-medium">Approver</th>
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
                  <td className="whitespace-nowrap px-3 py-2 align-top">
                    {a.assetCode ? (
                      <>
                        <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{a.assetCode}</code>
                        <div className="mt-0.5 max-w-[12rem] truncate text-xs text-muted-foreground" title={a.assetName ?? undefined}>
                          {a.assetName}
                        </div>
                      </>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 align-top">{a.assetType || <span className="text-muted-foreground">-</span>}</td>
                  <td className="whitespace-nowrap px-3 py-2 align-top font-medium text-foreground">{a.approverName ?? 'Approver'}</td>
                  <td className="whitespace-nowrap px-3 py-2 align-top">
                    <div>{a.requestedByName ?? '-'}</div>
                    <div className="text-xs text-muted-foreground">{fmtDate(a.requestedAt)}</div>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <span className="block max-w-[24rem] truncate" title={a.comment ?? undefined}>{a.comment || '-'}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 align-top">
                    <Badge variant={STATUS_VARIANT[a.status] ?? 'secondary'}>{a.status}</Badge>
                    {a.decidedAt && (
                      <div className="mt-0.5 text-xs text-muted-foreground">{fmtDate(a.decidedAt)}</div>
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
                          title="Withdraw request"
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

      <p className="text-xs text-muted-foreground">
        Approving a request issues the asset to whoever raised it — it appears on their Employee
        Master screen and is no longer available to anyone else.
      </p>

      {ConfirmDialog}
    </div>
  );
}
