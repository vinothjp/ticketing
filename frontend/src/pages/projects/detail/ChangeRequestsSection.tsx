import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useConfirm } from '@/hooks/useConfirm';
import { invalidateProject, type ProjectDetail } from '../projectMeta';

// A change request charges the customer for a NEW feature they requested. On approval it
// creates the new WBS item and raises the budget by the charged amount.
interface ChangeRequest {
  id: string; title: string; description?: string | null; reason?: string | null; scheduleImpact?: string | null;
  requestedBy?: string | null; status: string; decidedAt?: string | null;
  amount: number; budgetImpact: number | null;
  createdTask: { id: string; title: string } | null;
}
interface Budget { baseline: number; approvedChanges: number; pendingChanges: number; revisedBudget: number; totalCost: number; remaining: number; currency?: string | null; }
interface CrResponse { budget: Budget; changeRequests: ChangeRequest[]; }

const STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'];
const STATUS_LABEL: Record<string, string> = { DRAFT: 'Draft', SUBMITTED: 'Submitted', APPROVED: 'Approved', REJECTED: 'Rejected' };
const isTerminal = (s: string) => s === 'APPROVED' || s === 'REJECTED';
const statusVariant = (s: string): 'default' | 'secondary' | 'destructive' | 'success' | 'outline' =>
  s === 'APPROVED' ? 'success' : s === 'REJECTED' ? 'destructive' : 'secondary';

export default function ChangeRequestsSection({ project }: { project: ProjectDetail }) {
  const qc = useQueryClient();
  const { confirm, ConfirmDialog } = useConfirm();
  const { data, isLoading } = useQuery<CrResponse>({
    queryKey: ['projects', project.id, 'change-requests'],
    queryFn: async () => (await api.get(`/api/projects/${project.id}/change-requests`)).data,
  });
  const budget = data?.budget;
  const crs = data?.changeRequests ?? [];
  const cur = budget?.currency ? `${budget.currency} ` : '';
  const money = (n: number) => `${cur}${Math.round(n).toLocaleString()}`;

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ChangeRequest | null>(null);
  const [form, setForm] = useState({ title: '', description: '', reason: '', scheduleImpact: '', requestedBy: '', status: 'SUBMITTED' });
  const [amount, setAmount] = useState('');

  useEffect(() => {
    if (!open) return;
    setForm({
      title: editing?.title ?? '', description: editing?.description ?? '', reason: editing?.reason ?? '',
      scheduleImpact: editing?.scheduleImpact ?? '', requestedBy: editing?.requestedBy ?? '', status: editing?.status ?? 'SUBMITTED',
    });
    setAmount(editing?.amount != null ? String(editing.amount) : '');
  }, [open, editing]);

  const amt = Number(amount) || 0;
  // Preview: what the budget becomes if this change is approved (exclude its own amount if already approved).
  const revised = budget?.revisedBudget ?? 0;
  const base = revised - (editing?.status === 'APPROVED' ? editing.amount : 0);
  const budgetAfter = base + amt;

  const save = useMutation({
    mutationFn: async () => {
      if (!form.title.trim()) throw new Error('A title is required');
      const body = { ...form, budgetImpact: amt };
      if (editing) await api.patch(`/api/projects/registers/change-requests/${editing.id}`, body);
      else await api.post(`/api/projects/${project.id}/registers/change-requests`, body);
    },
    onSuccess: () => { invalidateProject(qc); setOpen(false); setEditing(null); toast.success('Saved'); },
    onError: (e: any) => toast.error(e.response?.data?.message || e.message || 'Error saving'),
  });

  const decide = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.patch(`/api/projects/change-requests/${id}/decision`, { status }),
    onSuccess: () => { invalidateProject(qc); toast.success('Updated'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  });

  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/api/projects/registers/change-requests/${id}`),
    onSuccess: () => { invalidateProject(qc); toast.success('Deleted'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  });

  return (
    <div className="space-y-4">
      {ConfirmDialog}

      {budget && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Sum label="Original budget" value={money(budget.baseline)} />
          <Sum label="Approved changes" value={(budget.approvedChanges > 0 ? '+' : '') + money(budget.approvedChanges)} tone={budget.approvedChanges > 0 ? 'good' : undefined} />
          <Sum label="Revised budget" value={money(budget.revisedBudget)} strong />
          <Sum label="Pending changes" value={money(budget.pendingChanges)} tone={budget.pendingChanges > 0 ? 'warn' : undefined} />
          <Sum label="Remaining" value={money(budget.remaining)} tone={budget.remaining >= 0 ? 'good' : 'bad'} />
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{crs.length} change request{crs.length === 1 ? '' : 's'} · charged to the customer for new scope</span>
        <Button size="sm" onClick={() => { setEditing(null); setOpen(true); }}><Plus className="size-4" /> Add Change Request</Button>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Requested by</TableHead>
              <TableHead>Schedule</TableHead>
              <TableHead className="text-right">Amount (charged)</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>New task</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Loading...</TableCell></TableRow>}
            {!isLoading && crs.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No change requests yet.</TableCell></TableRow>}
            {crs.map((cr) => (
              <TableRow key={cr.id}>
                <TableCell className="font-medium">{cr.title}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{cr.requestedBy || '—'}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{cr.scheduleImpact || '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{money(cr.amount)}</TableCell>
                <TableCell><Badge variant={statusVariant(cr.status)}>{STATUS_LABEL[cr.status] ?? cr.status}</Badge></TableCell>
                <TableCell className="text-sm text-muted-foreground">{cr.createdTask ? cr.createdTask.title : '—'}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    {!isTerminal(cr.status) && (
                      <>
                        <Button size="sm" variant="default" className="h-7 px-2 text-xs" disabled={decide.isPending} onClick={() => decide.mutate({ id: cr.id, status: 'APPROVED' })}><Check className="size-3.5" /> Approve</Button>
                        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={decide.isPending} onClick={() => decide.mutate({ id: cr.id, status: 'REJECTED' })}><X className="size-3.5" /> Reject</Button>
                      </>
                    )}
                    <Button size="icon" variant="outline" className="size-7" title="Edit" onClick={() => { setEditing(cr); setOpen(true); }}><Pencil className="size-3.5" /></Button>
                    <Button size="icon" variant="destructive" className="size-7" title="Delete"
                      onClick={async () => { if (await confirm({ title: 'Delete this change request?', destructive: true, confirmText: 'Delete' })) del.mutate(cr.id); }}><Trash2 className="size-3.5" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
        <DialogContent className="flex max-h-[88vh] flex-col sm:max-w-lg">
          <DialogHeader><DialogTitle>{editing ? 'Edit change request' : 'New change request'}</DialogTitle></DialogHeader>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Title"><Input value={form.title} onChange={(e) => setForm((s) => ({ ...s, title: e.target.value }))} /></Field>
              <Field label="Requested by"><Input value={form.requestedBy} onChange={(e) => setForm((s) => ({ ...s, requestedBy: e.target.value }))} /></Field>
              <Field label="Reason"><Input value={form.reason} onChange={(e) => setForm((s) => ({ ...s, reason: e.target.value }))} /></Field>
              <Field label="Schedule impact"><Input placeholder="e.g. +5 days" value={form.scheduleImpact} onChange={(e) => setForm((s) => ({ ...s, scheduleImpact: e.target.value }))} /></Field>
            </div>
            <Field label="Description (the new feature the customer asked for)"><Textarea rows={2} value={form.description} onChange={(e) => setForm((s) => ({ ...s, description: e.target.value }))} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Amount to charge the customer"><Input type="number" min="0" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
              <Field label="Status">
                <Select value={form.status} onValueChange={(v) => setForm((s) => ({ ...s, status: v }))}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{STATUSES.map((o) => <SelectItem key={o} value={o}>{STATUS_LABEL[o]}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
            </div>
            {budget && (
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                <div className="flex items-center justify-between"><span className="text-muted-foreground">Current budget</span><span className="tabular-nums">{money(base)}</span></div>
                <div className="mt-1 flex items-center justify-between font-medium"><span>Budget after this change</span><span className="tabular-nums text-success">{money(budgetAfter)}</span></div>
                <p className="mt-1 text-xs text-muted-foreground">Approving adds this amount to the budget and creates a new task for the feature.</p>
              </div>
            )}
          </div>
          <DialogFooter><Button disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving...' : 'Save'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div className="mb-1 text-sm">{label}</div>{children}</div>;
}

function Sum({ label, value, tone, strong }: { label: string; value: string; tone?: 'good' | 'bad' | 'warn'; strong?: boolean }) {
  const color = tone === 'good' ? 'text-success' : tone === 'bad' ? 'text-destructive' : tone === 'warn' ? 'text-amber-500' : 'text-foreground';
  return (
    <div className="rounded-lg border p-3">
      <div className={`${strong ? 'text-lg' : 'text-base'} font-bold tabular-nums ${color}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
