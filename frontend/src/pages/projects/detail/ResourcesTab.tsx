import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, UserPlus, Pencil, Check, User, BadgeCheck, Tag, Percent, Wallet, Banknote, Receipt } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import api from '../../../lib/api';
import { Button } from '@/components/ui/button';
import { DateField } from '@/components/ui/date-field';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useConfirm } from '@/hooks/useConfirm';
import ImportExportBar from '@/components/ImportExportBar';
import { invalidateProject, type ProjectDetail, type ResourceCategory, type UserOption } from '../projectMeta';

/**
 * A column heading: its icon, then its label. Muted and small, so the headings
 * read as chrome and the values below them carry the weight. Mirrors the
 * Change Management list.
 */
function HeadLabel({ icon: Icon, children, className = '' }: {
  icon: LucideIcon; children: ReactNode; className?: string;
}) {
  return (
    <span className={`flex items-center gap-1.5 text-xs font-semibold text-muted-foreground ${className}`}>
      <Icon className="size-3.5 shrink-0" />
      {children}
    </span>
  );
}

const NONE = '__none__';
const money = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
const toDate = (v?: string | null) => (v ? new Date(v).toISOString().slice(0, 10) : '');
const HEAD = 'text-xs font-semibold text-muted-foreground';

// One figure in the summary strip above the plan: muted label, bold value.
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <span className="text-muted-foreground">{label}</span>{' '}
      <span className="font-semibold tabular-nums">{value}</span>
    </span>
  );
}

type MemberForm = {
  id: string | null;
  userId: string;
  categoryId: string;
  role: string;
  alloc: string;
  billable: boolean;
  startDate: string;
  endDate: string;
};
const emptyForm = (project: ProjectDetail): MemberForm => ({
  id: null, userId: '', categoryId: '', role: '', alloc: '100', billable: true,
  startDate: toDate(project.startDate), endDate: toDate(project.endDate),
});

export default function ResourcesTab({ project, users, prefillUserId, onPrefillUsed }: {
  project: ProjectDetail;
  users: UserOption[];
  /** Open Add Member with this user already picked — sent here from an assignee picker. */
  prefillUserId?: string | null;
  onPrefillUsed?: () => void;
}) {
  const qc = useQueryClient();
  const { confirm, ConfirmDialog } = useConfirm();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<MemberForm>(emptyForm(project));
  const invalidate = () => invalidateProject(qc);

  const { data: categories = [] } = useQuery<ResourceCategory[]>({
    queryKey: ['resource-categories'],
    queryFn: async () => (await api.get('/api/resource-categories')).data,
  });
  const catById = new Map(categories.map((c) => [c.id, c]));

  const payload = (f: MemberForm) => ({
    userId: f.userId || undefined,
    consultantName: f.userId ? users.find((u) => u.id === f.userId)?.username : undefined,
    categoryId: f.categoryId || undefined,
    role: f.role || undefined,
    allocationPct: Number(f.alloc) || 100,
    billable: f.billable,
    startDate: f.startDate || undefined,
    endDate: f.endDate || undefined,
  });

  const save = useMutation({
    mutationFn: (f: MemberForm) => f.id
      ? api.patch(`/api/projects/resources/${f.id}`, payload(f))
      : api.post(`/api/projects/${project.id}/resources`, payload(f)),
    onSuccess: (_r, f) => { invalidate(); setOpen(false); toast.success(f.id ? 'Member updated' : 'Member added'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error saving member'),
  });
  const delResource = useMutation({
    mutationFn: (id: string) => api.delete(`/api/projects/resources/${id}`),
    onSuccess: () => { invalidate(); toast.success('Removed'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  });

  const openNew = () => { setForm(emptyForm(project)); setOpen(true); };
  useEffect(() => {
    if (!prefillUserId) return;
    setForm({ ...emptyForm(project), userId: prefillUserId });
    setOpen(true);
    onPrefillUsed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillUserId]);

  // A member is planned inside the project's window; the pickers block every day outside it.
  const projStart = toDate(project.startDate) || undefined;
  const projEnd = toDate(project.endDate) || undefined;
  const latest = (...ds: (string | undefined)[]) => ds.filter(Boolean).sort().slice(-1)[0] as string | undefined;
  const earliest = (...ds: (string | undefined)[]) => ds.filter(Boolean).sort()[0] as string | undefined;
  const openEdit = (r: ProjectDetail['resources'][number]) => {
    setForm({
      id: r.id, userId: r.userId ?? '', categoryId: r.categoryId ?? '', role: r.role ?? '',
      alloc: String(r.allocationPct ?? 100), billable: !!r.billable, startDate: toDate(r.startDate), endDate: toDate(r.endDate),
    });
    setOpen(true);
  };

  // Planned cost/billing = daily rate × allocation × business days over the project window.
  const rows = project.resources.map((r) => {
    const cat = r.categoryId ? catById.get(r.categoryId) : undefined;
    const days = r.startDate && r.endDate ? Math.max(1, Math.round((new Date(r.endDate).getTime() - new Date(r.startDate).getTime()) / 86400000)) : 0;
    const factor = (r.allocationPct / 100) * days;
    return { r, cat, cost: cat ? cat.dailyCost * factor : 0, billing: cat && r.billable ? cat.dailyBilling * factor : 0 };
  });
  const totalCost = rows.reduce((s, x) => s + x.cost, 0);
  const totalBilling = rows.reduce((s, x) => s + x.billing, 0);

  return (
    <div className="space-y-4">
      {ConfirmDialog}
      <div className="flex flex-wrap items-baseline gap-x-8 gap-y-1 border-b pb-3 text-sm">
        <span>
          <span className="font-semibold tabular-nums">{project.resources.length}</span>{' '}
          <span className="text-muted-foreground">member{project.resources.length === 1 ? '' : 's'}</span>
        </span>
        <Stat label="Planned cost" value={money(totalCost)} />
        <Stat label="Billing" value={money(totalBilling)} />
        <Stat label="Margin" value={money(totalBilling - totalCost)} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <ImportExportBar
            noun="resources"
            templateName="resource-import-template.xlsx"
            exportUrl={`/api/projects/${project.id}/resources/export`}
            templateUrl="/api/projects/resources/import-template"
            importUrl={`/api/projects/${project.id}/resources/import`}
            onImported={invalidate}
          />
        </div>
        <Button onClick={openNew}><Plus className="size-4" /> Add Member</Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{form.id ? 'Edit member' : 'Add member to plan'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <div className="mb-1 text-sm">Member</div>
              <Select value={form.userId || NONE} onValueChange={(v) => setForm((f) => ({ ...f, userId: v === NONE ? '' : v }))}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Select user" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>—</SelectItem>
                  {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.username}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="mb-1 text-sm">Category (rate) <span className="text-destructive">*</span></div>
                <Select value={form.categoryId || undefined} onValueChange={(v) => { if (v) setForm((f) => ({ ...f, categoryId: v })); }}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Select category" /></SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <div className="mb-1 text-sm">Allocation %</div>
                <Input type="number" min={0} max={100} value={form.alloc} onChange={(e) => setForm((f) => ({ ...f, alloc: e.target.value }))} />
              </div>
            </div>
            <div>
              <div className="mb-1 text-sm">Role</div>
              <Input value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))} placeholder="e.g. Lead Developer" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="mb-1 text-sm">Start date</div>
                <DateField value={form.startDate} min={projStart} max={earliest(form.endDate || undefined, projEnd)} onChange={(v) => setForm((f) => ({ ...f, startDate: v }))} />
              </div>
              <div>
                <div className="mb-1 text-sm">End date</div>
                <DateField value={form.endDate} min={latest(form.startDate || undefined, projStart)} max={projEnd} onChange={(v) => setForm((f) => ({ ...f, endDate: v }))} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={form.billable} onCheckedChange={(v) => setForm((f) => ({ ...f, billable: !!v }))} /> Billable
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={save.isPending} onClick={() => {
              // No category means no rate: the member would plan and bill at 0.
              if (!form.categoryId) { toast.error(`Select a category — it sets the member's daily cost and billing rate`); return; }
              save.mutate(form);
            }}><UserPlus className="size-4" /> {form.id ? 'Save changes' : 'Add member'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead className="border-r"><HeadLabel icon={User}>Consultant</HeadLabel></TableHead>
              <TableHead className="border-r"><HeadLabel icon={BadgeCheck}>Role</HeadLabel></TableHead>
              <TableHead className="border-r"><HeadLabel icon={Tag}>Category</HeadLabel></TableHead>
              <TableHead className="border-r"><HeadLabel icon={Percent} className="justify-end">Allocation</HeadLabel></TableHead>
              <TableHead className="border-r"><HeadLabel icon={Wallet} className="justify-end">Cost/day</HeadLabel></TableHead>
              <TableHead className="border-r"><HeadLabel icon={Banknote} className="justify-end">Billing/day</HeadLabel></TableHead>
              <TableHead className="border-r"><HeadLabel icon={Receipt} className="justify-center">Billable</HeadLabel></TableHead>
              <TableHead className={`${HEAD} w-px text-right`}>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {project.resources.length === 0 && <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">No resources planned.</TableCell></TableRow>}
            {rows.map(({ r, cat }) => (
              <TableRow key={r.id}>
                <TableCell className="border-r font-medium">{r.user?.username || r.consultantName || '—'}</TableCell>
                <TableCell className="border-r"><span className="block max-w-[14rem] truncate" title={r.role ?? undefined}>{r.role || '—'}</span></TableCell>
                <TableCell className="border-r">{cat?.name || '—'}</TableCell>
                <TableCell className="border-r text-right tabular-nums">{r.allocationPct}%</TableCell>
                <TableCell className="border-r text-right tabular-nums">{cat ? money(cat.dailyCost) : '—'}</TableCell>
                <TableCell className="border-r text-right tabular-nums">{cat ? money(cat.dailyBilling) : '—'}</TableCell>
                <TableCell className="border-r text-center">
                  {r.billable
                    ? <Check className="mx-auto size-4 text-emerald-600" aria-label="Billable" />
                    : <span className="text-muted-foreground" title="Not billable">—</span>}
                </TableCell>
                <TableCell className="w-px text-right">
                  <div className="flex justify-end gap-1">
                    <Button size="icon" variant="ghost" className="size-8" onClick={() => openEdit(r)}><Pencil className="size-4" /></Button>
                    <Button size="icon" variant="ghost" className="size-8 text-destructive hover:text-destructive"
                      onClick={async () => { if (await confirm({ title: 'Remove this member?', destructive: true, confirmText: 'Remove' })) delResource.mutate(r.id); }}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
