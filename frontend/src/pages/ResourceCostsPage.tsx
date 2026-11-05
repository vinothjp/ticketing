import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Tag, Clock, Receipt, Timer, Coins, Banknote, TrendingUp } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import api from '../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

/**
 * A column heading: its icon, then its label. Muted and small, so the headings
 * read as chrome and the values below them carry the weight. Mirrors the task
 * grid on the ticket detail screen.
 */
function HeadLabel({ icon: Icon, children, align = 'start' }: {
  icon: LucideIcon; children: ReactNode; align?: 'start' | 'end';
}) {
  return (
    <span className={`flex items-center gap-1.5 text-xs font-semibold text-muted-foreground ${
      align === 'end' ? 'justify-end' : ''
    }`}>
      <Icon className="size-3.5 shrink-0" />
      {children}
    </span>
  );
}

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import type { ResourceCategory } from './projects/projectMeta';

const money = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });

export default function ResourceCostsPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<ResourceCategory | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [hourlyCost, setHourlyCost] = useState('0');
  const [billingRate, setBillingRate] = useState('0');
  const [dailyHours, setDailyHours] = useState('8');

  const { data: cats = [], isLoading } = useQuery<ResourceCategory[]>({
    queryKey: ['resource-categories'],
    queryFn: async () => (await api.get('/api/resource-categories')).data,
  });

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setName(editing.name); setHourlyCost(String(editing.hourlyCost)); setBillingRate(String(editing.billingRate)); setDailyHours(String(editing.dailyHours));
    } else { setName(''); setHourlyCost('0'); setBillingRate('0'); setDailyHours('8'); }
  }, [open, editing]);

  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), hourlyCost: Number(hourlyCost), billingRate: Number(billingRate), dailyHours: Number(dailyHours) };
      return editing ? api.patch(`/api/resource-categories/${editing.id}`, body) : api.post('/api/resource-categories', body);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['resource-categories'] }); setOpen(false); setEditing(null); toast.success('Saved'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error saving'),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/api/resource-categories/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['resource-categories'] }); toast.success('Deleted'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  });

  const preview = { dailyCost: Number(hourlyCost) * Number(dailyHours), dailyBilling: Number(billingRate) * Number(dailyHours) };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Resource Costs</h1>
        <Button onClick={() => { setEditing(null); setOpen(true); }}><Plus className="size-4" /> New Category</Button>
      </div>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? 'Edit category' : 'New category'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><div className="mb-1 text-sm">Category name</div><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sr Developer" /></div>
            <div className="grid grid-cols-3 gap-3">
              <div><div className="mb-1 text-sm">Hourly cost</div><Input type="number" min={0} value={hourlyCost} onChange={(e) => setHourlyCost(e.target.value)} /></div>
              <div><div className="mb-1 text-sm">Billing rate</div><Input type="number" min={0} value={billingRate} onChange={(e) => setBillingRate(e.target.value)} /></div>
              <div><div className="mb-1 text-sm">Daily hours</div><Input type="number" min={1} value={dailyHours} onChange={(e) => setDailyHours(e.target.value)} /></div>
            </div>
            <p className="text-xs text-muted-foreground">
              Daily cost {money(preview.dailyCost)} · daily billing {money(preview.dailyBilling)} · profit {money(preview.dailyBilling - preview.dailyCost)}
            </p>
          </div>
          <DialogFooter><Button disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {isLoading ? <p className="text-muted-foreground">Loading...</p> : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="w-full border-r"><HeadLabel icon={Tag}>Category</HeadLabel></TableHead>
                <TableHead className="border-r"><HeadLabel icon={Clock} align="end">Hourly cost</HeadLabel></TableHead>
                <TableHead className="border-r"><HeadLabel icon={Receipt} align="end">Billing rate</HeadLabel></TableHead>
                <TableHead className="border-r"><HeadLabel icon={Timer} align="end">Daily hrs</HeadLabel></TableHead>
                <TableHead className="border-r"><HeadLabel icon={Coins} align="end">Daily cost</HeadLabel></TableHead>
                <TableHead className="border-r"><HeadLabel icon={Banknote} align="end">Daily billing</HeadLabel></TableHead>
                <TableHead className="border-r"><HeadLabel icon={TrendingUp} align="end">Profit / day</HeadLabel></TableHead>
                <TableHead className="text-right text-xs font-semibold text-muted-foreground">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cats.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">No categories yet.</TableCell></TableRow>}
              {cats.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="w-full border-r font-medium text-foreground">{c.name}</TableCell>
                  <TableCell className="border-r text-right tabular-nums">{money(c.hourlyCost)}</TableCell>
                  <TableCell className="border-r text-right tabular-nums">{money(c.billingRate)}</TableCell>
                  <TableCell className="border-r text-right tabular-nums">{c.dailyHours}</TableCell>
                  <TableCell className="border-r text-right tabular-nums">{money(c.dailyCost)}</TableCell>
                  <TableCell className="border-r text-right tabular-nums">{money(c.dailyBilling)}</TableCell>
                  <TableCell className="border-r text-right font-medium tabular-nums text-success">{money(c.profit)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={() => { setEditing(c); setOpen(true); }}><Pencil className="size-4" /></Button>
                      <Button size="sm" variant="destructive" onClick={() => { if (confirm(`Delete "${c.name}"?`)) del.mutate(c.id); }}><Trash2 className="size-4" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
