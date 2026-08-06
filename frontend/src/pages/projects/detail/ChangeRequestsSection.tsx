import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Check, X, Send, Search } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useConfirm } from '@/hooks/useConfirm';
import { invalidateProject, type ProjectDetail } from '../projectMeta';

// ----- Types (mirror the /change-requests endpoint) -----
interface CrTask { id: string; wbsCode?: string | null; title: string; assigneeName?: string | null; isParent?: boolean; changeRequestId?: string | null; estimatedHours: number; unitCost: number; taskCost: number; }
interface LinkedTask { id: string; wbsCode?: string | null; title: string; assigneeName?: string | null; estimatedHours: number; unitCost: number; taskCost: number; }
interface Verdict { withinBudget: boolean; remaining: number; shortfall: number; }
interface ChangeRequest {
  id: string; title: string; description?: string | null; reason?: string | null; scheduleImpact?: string | null;
  requestedBy?: string | null; status: string; decidedAt?: string | null;
  budgetImpact: number | null; costEstimate: number | null;
  linkedTasks: LinkedTask[]; costSuggested: number; cost: number; verdict: Verdict;
}
interface Budget { baseline: number; approvedChanges: number; pendingChanges: number; revisedBudget: number; totalCost: number; remaining: number; currency?: string | null; }
interface CrResponse { budget: Budget; changeRequests: ChangeRequest[]; tasks: CrTask[]; }

const STATUSES = ['DRAFT', 'SUBMITTED', 'PENDING_CUSTOMER', 'CUSTOMER_APPROVED', 'APPROVED', 'REJECTED'];
const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft', SUBMITTED: 'Submitted', PENDING_CUSTOMER: 'With customer',
  CUSTOMER_APPROVED: 'Customer approved', APPROVED: 'Approved', REJECTED: 'Rejected',
};
const APPROVED = (s: string) => s === 'APPROVED' || s === 'CUSTOMER_APPROVED';
const statusVariant = (s: string): 'default' | 'secondary' | 'destructive' | 'success' | 'outline' =>
  APPROVED(s) ? 'success' : s === 'REJECTED' ? 'destructive' : s === 'PENDING_CUSTOMER' ? 'default' : 'secondary';

export default function ChangeRequestsSection({ project }: { project: ProjectDetail }) {
  const qc = useQueryClient();
  const { confirm, ConfirmDialog } = useConfirm();
  const { data, isLoading } = useQuery<CrResponse>({
    queryKey: ['projects', project.id, 'change-requests'],
    queryFn: async () => (await api.get(`/api/projects/${project.id}/change-requests`)).data,
  });
  const budget = data?.budget;
  const crs = data?.changeRequests ?? [];
  const allTasks = data?.tasks ?? [];
  const cur = budget?.currency ? `${budget.currency} ` : '';
  const money = (n: number) => `${cur}${Math.round(n).toLocaleString()}`;

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ChangeRequest | null>(null);
  const [form, setForm] = useState({ title: '', description: '', reason: '', scheduleImpact: '', requestedBy: '', status: 'DRAFT' });
  const [costOverride, setCostOverride] = useState('');   // '' = auto (use suggested)
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [taskSearch, setTaskSearch] = useState('');

  useEffect(() => {
    if (!open) return;
    setForm({
      title: editing?.title ?? '', description: editing?.description ?? '', reason: editing?.reason ?? '',
      scheduleImpact: editing?.scheduleImpact ?? '', requestedBy: editing?.requestedBy ?? '', status: editing?.status ?? 'DRAFT',
    });
    setCostOverride(editing?.costEstimate != null ? String(editing.costEstimate) : '');
    setSelected(new Set(editing ? allTasks.filter((t) => t.changeRequestId === editing.id).map((t) => t.id) : []));
    setTaskSearch('');
  }, [open, editing]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cost sums only leaf tasks so selecting a parent + its children never double-counts.
  const suggested = useMemo(
    () => allTasks.filter((t) => selected.has(t.id) && !t.isParent).reduce((s, t) => s + t.taskCost, 0),
    [selected, allTasks],
  );
  // One "Change cost" field: empty override = auto (tracks the suggested sum live); once the
  // user types a number it becomes a manual override that supersedes the auto amount.
  const isOverridden = costOverride.trim() !== '';
  const effectiveCost = isOverridden ? Number(costOverride) || 0 : suggested;
  const costFieldValue = isOverridden ? costOverride : String(Math.round(suggested));
  const remaining = budget?.remaining ?? 0;
  const withinBudget = effectiveCost <= remaining;
  const shortfall = Math.max(0, effectiveCost - remaining);

  const filteredTasks = useMemo(() => {
    const q = taskSearch.trim().toLowerCase();
    return allTasks.filter((t) => !q || t.title.toLowerCase().includes(q) || (t.wbsCode ?? '').includes(q));
  }, [allTasks, taskSearch]);

  const save = useMutation({
    mutationFn: async () => {
      if (!form.title.trim()) throw new Error('A title is required');
      const body = {
        ...form,
        // Explicit null clears the override → cost reverts to the auto sum.
        costEstimate: costOverride.trim() !== '' ? Number(costOverride) : null,
      };
      const crId = editing
        ? (await api.patch(`/api/projects/registers/change-requests/${editing.id}`, body), editing.id)
        : (await api.post(`/api/projects/${project.id}/registers/change-requests`, body)).data.id;
      await api.put(`/api/projects/change-requests/${crId}/tasks`, { taskIds: [...selected] });
    },
    onSuccess: () => { invalidateProject(qc); setOpen(false); setEditing(null); toast.success('Saved'); },
    onError: (e: any) => toast.error(e.response?.data?.message || e.message || 'Error saving'),
  });

  const setStatus = useMutation({
    mutationFn: async ({ cr, status }: { cr: ChangeRequest; status: string }) => {
      const body: Record<string, any> = {
        status,
        decidedAt: APPROVED(status) || status === 'REJECTED' ? new Date().toISOString() : null,
      };
      // Approving an over-budget change defaults the budget increase to the shortfall.
      if (APPROVED(status) && (cr.budgetImpact ?? 0) === 0 && cr.verdict.shortfall > 0) body.budgetImpact = cr.verdict.shortfall;
      await api.patch(`/api/projects/registers/change-requests/${cr.id}`, body);
    },
    onSuccess: () => { invalidateProject(qc); toast.success('Updated'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  });

  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/api/projects/registers/change-requests/${id}`),
    onSuccess: () => { invalidateProject(qc); toast.success('Deleted'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  });

  // WBS-aware selection: a row covers itself + every descendant (matched by wbsCode prefix,
  // e.g. "8" owns "8.1", "8.1.1"). Checking a parent checks the whole branch; a row reads
  // "indeterminate" when only some of its descendants are selected.
  const groupIds = (t: CrTask) => {
    const code = t.wbsCode ?? '';
    return allTasks.filter((x) => x.id === t.id || (!!code && !!x.wbsCode && x.wbsCode.startsWith(`${code}.`))).map((x) => x.id);
  };
  const rowState = (t: CrTask): boolean | 'indeterminate' => {
    const ids = groupIds(t);
    const sel = ids.filter((id) => selected.has(id)).length;
    return sel === 0 ? false : sel === ids.length ? true : 'indeterminate';
  };
  const toggle = (t: CrTask) => {
    const ids = groupIds(t);
    const fullySelected = ids.every((id) => selected.has(id));
    setSelected((p) => { const n = new Set(p); for (const id of ids) fullySelected ? n.delete(id) : n.add(id); return n; });
  };

  // Workflow buttons available for a CR given its status + budget verdict.
  const workflow = (cr: ChangeRequest): { label: string; status: string; variant: any; icon: any }[] => {
    if (APPROVED(cr.status) || cr.status === 'REJECTED') return [];
    const acts: { label: string; status: string; variant: any; icon: any }[] = [];
    if (cr.verdict.withinBudget) acts.push({ label: 'Approve', status: 'APPROVED', variant: 'default', icon: Check });
    else if (cr.status !== 'PENDING_CUSTOMER') acts.push({ label: 'Send to customer', status: 'PENDING_CUSTOMER', variant: 'secondary', icon: Send });
    else acts.push({ label: 'Customer approved', status: 'CUSTOMER_APPROVED', variant: 'default', icon: Check });
    acts.push({ label: 'Reject', status: 'REJECTED', variant: 'outline', icon: X });
    return acts;
  };

  return (
    <div className="space-y-4">
      {ConfirmDialog}

      {/* Budget summary */}
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
        <span className="text-sm text-muted-foreground">{crs.length} change request{crs.length === 1 ? '' : 's'}</span>
        <Button size="sm" onClick={() => { setEditing(null); setOpen(true); }}><Plus className="size-4" /> Add Change Request</Button>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Tasks</TableHead>
              <TableHead>Schedule</TableHead>
              <TableHead className="text-right">Change cost</TableHead>
              <TableHead>Budget</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Loading...</TableCell></TableRow>}
            {!isLoading && crs.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No change requests yet.</TableCell></TableRow>}
            {crs.map((cr) => (
              <TableRow key={cr.id}>
                <TableCell className="font-medium">
                  {cr.title}
                  {cr.requestedBy && <span className="ml-1 text-xs text-muted-foreground">· {cr.requestedBy}</span>}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{cr.linkedTasks.length || '—'}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{cr.scheduleImpact || '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{money(cr.cost)}</TableCell>
                <TableCell>
                  {cr.verdict.withinBudget
                    ? <Badge variant="success">Within budget</Badge>
                    : <Badge variant="destructive">Needs +{money(cr.verdict.shortfall)}</Badge>}
                </TableCell>
                <TableCell><Badge variant={statusVariant(cr.status)}>{STATUS_LABEL[cr.status] ?? cr.status}</Badge></TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    {workflow(cr).map((a) => (
                      <Button key={a.status} size="sm" variant={a.variant} className="h-7 px-2 text-xs" disabled={setStatus.isPending}
                        onClick={() => setStatus.mutate({ cr, status: a.status })}>
                        <a.icon className="size-3.5" /> {a.label}
                      </Button>
                    ))}
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

      {/* Add / edit dialog */}
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
        <DialogContent className="flex max-h-[88vh] flex-col sm:max-w-2xl">
          <DialogHeader><DialogTitle>{editing ? 'Edit change request' : 'New change request'}</DialogTitle></DialogHeader>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Title"><Input value={form.title} onChange={(e) => setForm((s) => ({ ...s, title: e.target.value }))} /></Field>
              <Field label="Requested by"><Input value={form.requestedBy} onChange={(e) => setForm((s) => ({ ...s, requestedBy: e.target.value }))} /></Field>
              <Field label="Reason"><Input value={form.reason} onChange={(e) => setForm((s) => ({ ...s, reason: e.target.value }))} /></Field>
              <Field label="Schedule impact"><Input placeholder="e.g. +5 days" value={form.scheduleImpact} onChange={(e) => setForm((s) => ({ ...s, scheduleImpact: e.target.value }))} /></Field>
            </div>
            <Field label="Description"><Textarea rows={2} value={form.description} onChange={(e) => setForm((s) => ({ ...s, description: e.target.value }))} /></Field>
            <Field label="Status">
              <Select value={form.status} onValueChange={(v) => setForm((s) => ({ ...s, status: v }))}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{STATUSES.map((o) => <SelectItem key={o} value={o}>{STATUS_LABEL[o]}</SelectItem>)}</SelectContent>
              </Select>
            </Field>

            {/* Task linking */}
            <div className="border-t pt-3">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-sm font-medium">New / changed tasks</span>
                <span className="text-xs text-muted-foreground">{selected.size} selected</span>
              </div>
              <div className="relative mb-2">
                <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input className="h-8 pl-7" placeholder="Search tasks…" value={taskSearch} onChange={(e) => setTaskSearch(e.target.value)} />
              </div>
              <div className="max-h-52 space-y-0.5 overflow-y-auto rounded-md border p-1">
                {filteredTasks.length === 0 && <p className="p-2 text-center text-xs text-muted-foreground">No tasks.</p>}
                {filteredTasks.map((t) => (
                  <label key={t.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent/50">
                    <Checkbox checked={rowState(t)} onCheckedChange={() => toggle(t)} />
                    <span className="font-mono text-xs text-muted-foreground">{t.wbsCode}</span>
                    <span className="flex-1 truncate">{t.title}</span>
                    <span className="text-xs text-muted-foreground">{t.assigneeName || '—'}</span>
                    <span className="w-16 text-right tabular-nums text-xs">{t.taskCost ? money(t.taskCost) : '—'}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Change cost + budget verdict */}
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Change cost</span>
                  {isOverridden && (
                    <button type="button" className="text-xs text-primary hover:underline" onClick={() => setCostOverride('')}>
                      reset to suggested ({money(suggested)})
                    </button>
                  )}
                </div>
                <Input type="number" className="h-8 w-32 text-right" value={costFieldValue} onChange={(e) => setCostOverride(e.target.value)} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {isOverridden ? 'Manual amount.' : 'Auto-calculated from the linked tasks.'} Edit the box to change it; clear it to go back to the auto amount.
              </p>
              <div className="mt-2 flex items-center justify-between border-t pt-2">
                <span className="text-muted-foreground">Remaining budget</span>
                <span className="tabular-nums">{money(remaining)}</span>
              </div>
              <div className={`mt-1 flex items-center justify-between font-medium ${withinBudget ? 'text-success' : 'text-destructive'}`}>
                <span>Change cost {money(effectiveCost)}</span>
                <span>{withinBudget ? '→ within budget' : `→ exceeds by ${money(shortfall)} · request increase`}</span>
              </div>
              {!withinBudget && (
                <p className="mt-1 text-xs text-muted-foreground">On approval the budget will be revised up by the shortfall ({money(shortfall)}); route it to the customer first.</p>
              )}
            </div>
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
