import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, UserPlus, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useConfirm } from '@/hooks/useConfirm';
import { invalidateProject, type ProjectDetail, type ResourceCategory, type UserOption } from '../projectMeta';

const NONE = '__none__';
const money = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
const toDate = (v?: string | null) => (v ? new Date(v).toISOString().slice(0, 10) : '');

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

export default function ResourcesTab({ project, users }: { project: ProjectDetail; users: UserOption[] }) {
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
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {project.resources.length} member{project.resources.length === 1 ? '' : 's'} · planned cost {money(totalCost)} · billing {money(totalBilling)} · margin {money(totalBilling - totalCost)}
        </span>
        <Button size="sm" onClick={openNew}><Plus className="size-4" /> Add Member</Button>
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
                <div className="mb-1 text-sm">Category (rate)</div>
                <Select value={form.categoryId || NONE} onValueChange={(v) => setForm((f) => ({ ...f, categoryId: v === NONE ? '' : v }))}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>None</SelectItem>
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
                <Input type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} />
              </div>
              <div>
                <div className="mb-1 text-sm">End date</div>
                <Input type="date" value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={form.billable} onCheckedChange={(v) => setForm((f) => ({ ...f, billable: !!v }))} /> Billable
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={save.isPending} onClick={() => save.mutate(form)}><UserPlus className="size-4" /> {form.id ? 'Save changes' : 'Add member'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="overflow-x-auto border-t">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Consultant</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Alloc %</TableHead>
              <TableHead className="text-right">Daily cost</TableHead>
              <TableHead className="text-right">Daily billing</TableHead>
              <TableHead>Billable</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {project.resources.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">No resources planned.</TableCell></TableRow>}
            {rows.map(({ r, cat }) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.user?.username || r.consultantName || '—'}</TableCell>
                <TableCell>{r.role || '—'}</TableCell>
                <TableCell>{cat?.name || '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{r.allocationPct}%</TableCell>
                <TableCell className="text-right tabular-nums">{cat ? money(cat.dailyCost) : '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{cat ? money(cat.dailyBilling) : '—'}</TableCell>
                <TableCell>{r.billable ? <Badge variant="success">Billable</Badge> : <Badge variant="outline">No</Badge>}</TableCell>
                <TableCell className="text-right">
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
