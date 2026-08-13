import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Trash2, Plus } from 'lucide-react';
import api from '../../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

interface Coverage { end: string | null; daysLeft: number | null; pct: number; active: boolean }
interface Purchased {
  id: string; productId: string; productName: string; productCode: string;
  status: 'ACTIVE' | 'EXPIRED' | 'TERMINATED'; purchaseDate: string | null;
  warranty: Coverage & { months: number };
  amc: Coverage & { type: 'FREE' | 'PAID'; monthlyCost: number | null; hoursPerMonth: number | null; visitsPerMonth: number | null; freeMonths: number };
}
interface CatProduct { id: string; name: string; code: string }

const today = () => new Date().toISOString().slice(0, 10);
const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString() : '—');
const statusCls = (s: string) =>
  s === 'ACTIVE' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
  : s === 'EXPIRED' ? 'bg-destructive/15 text-destructive border-destructive/30'
  : 'bg-muted text-muted-foreground border-border';

export default function CompanyProductsDialog({ companyId, companyName, onClose }: { companyId: string; companyName: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [assign, setAssign] = useState({ productId: '', purchaseDate: today(), warrantyMonths: 12, freeAmcMonths: 12, amcMonthlyCost: 100000, amcHoursPerMonth: 40, amcVisitsPerMonth: 2 });
  const [renewFor, setRenewFor] = useState<Purchased | null>(null);
  const [renew, setRenew] = useState({ months: 12, amcMonthlyCost: 100000 });

  const { data: owned = [] } = useQuery<Purchased[]>({
    queryKey: ['company-products', companyId],
    queryFn: async () => (await api.get(`/api/customer-companies/${companyId}/purchased-products`)).data,
  });
  const { data: allProducts = [] } = useQuery<CatProduct[]>({
    queryKey: ['products'],
    queryFn: async () => (await api.get('/api/products')).data,
  });
  const ownedIds = new Set(owned.map((o) => o.productId));
  const assignable = allProducts.filter((p) => !ownedIds.has(p.id));

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['company-products', companyId] });
    qc.invalidateQueries({ queryKey: ['customer-companies'] });
  };

  const doAssign = useMutation({
    mutationFn: () => api.post(`/api/customer-companies/${companyId}/purchased-products`, assign),
    onSuccess: () => { invalidate(); setAssign((a) => ({ ...a, productId: '' })); toast.success('Product assigned'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  });
  const doRemove = useMutation({
    mutationFn: (cpId: string) => api.delete(`/api/customer-companies/purchased-products/${cpId}`),
    onSuccess: () => { invalidate(); toast.success('Product removed'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  });
  const doRenew = useMutation({
    mutationFn: () => api.post(`/api/customer-companies/purchased-products/${renewFor!.id}/renew`, renew),
    onSuccess: () => { invalidate(); setRenewFor(null); toast.success('AMC renewed'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-2xl">
        <DialogHeader><DialogTitle>{companyName} — products</DialogTitle></DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          {owned.length === 0 ? (
            <p className="text-sm text-muted-foreground">No products assigned yet.</p>
          ) : owned.map((p) => (
            <div key={p.id} className="rounded-lg border p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground">{p.productName}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${statusCls(p.status)}`}>{p.status.toLowerCase()}</span>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => { setRenewFor(p); setRenew({ months: 12, amcMonthlyCost: p.amc.monthlyCost ?? 100000 }); }}>Renew AMC</Button>
                  <Button size="icon" variant="ghost" className="size-8 text-destructive hover:text-destructive" onClick={() => doRemove.mutate(p.id)}><Trash2 className="size-4" /></Button>
                </div>
              </div>
              <div className="mt-1 grid grid-cols-2 gap-x-4 text-xs text-muted-foreground">
                <span>Purchased {fmt(p.purchaseDate)}</span>
                <span>Warranty: {p.warranty.pct}% · ends {fmt(p.warranty.end)}</span>
                <span>AMC ({p.amc.type.toLowerCase()}): {p.amc.pct}% · ends {fmt(p.amc.end)}</span>
                <span>{p.amc.monthlyCost != null ? `₹${p.amc.monthlyCost.toLocaleString('en-IN')}/mo · ${p.amc.hoursPerMonth ?? '—'}h · ${p.amc.visitsPerMonth ?? '—'} visits` : ''}</span>
              </div>
            </div>
          ))}

          {/* Assign a new product with terms */}
          <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
            <div className="text-sm font-medium">Assign a product</div>
            <Select value={assign.productId} onValueChange={(v) => setAssign({ ...assign, productId: v })}>
              <SelectTrigger><SelectValue placeholder="Choose a product" /></SelectTrigger>
              <SelectContent>
                {assignable.length === 0 ? <SelectItem value="__none" disabled>All products assigned</SelectItem>
                  : assignable.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="grid grid-cols-3 gap-2">
              <Num label="Purchase date" type="date" value={assign.purchaseDate} onChange={(v) => setAssign({ ...assign, purchaseDate: v as string })} />
              <Num label="Warranty (mo)" value={assign.warrantyMonths} onChange={(v) => setAssign({ ...assign, warrantyMonths: Number(v) })} />
              <Num label="Free AMC (mo)" value={assign.freeAmcMonths} onChange={(v) => setAssign({ ...assign, freeAmcMonths: Number(v) })} />
              <Num label="Paid ₹/mo" value={assign.amcMonthlyCost} onChange={(v) => setAssign({ ...assign, amcMonthlyCost: Number(v) })} />
              <Num label="Hours/mo" value={assign.amcHoursPerMonth} onChange={(v) => setAssign({ ...assign, amcHoursPerMonth: Number(v) })} />
              <Num label="Visits/mo" value={assign.amcVisitsPerMonth} onChange={(v) => setAssign({ ...assign, amcVisitsPerMonth: Number(v) })} />
            </div>
            <Button size="sm" disabled={!assign.productId || doAssign.isPending} onClick={() => doAssign.mutate()}>
              <Plus className="size-3.5" /> Assign product
            </Button>
          </div>
        </div>

        <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>

        {/* Renew sub-dialog */}
        <Dialog open={!!renewFor} onOpenChange={(o) => !o && setRenewFor(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Renew AMC — {renewFor?.productName}</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">Starts a paid AMC period from today and reactivates the product.</p>
            <div className="grid grid-cols-2 gap-3">
              <Num label="Months" value={renew.months} onChange={(v) => setRenew({ ...renew, months: Number(v) })} />
              <Num label="₹/month" value={renew.amcMonthlyCost} onChange={(v) => setRenew({ ...renew, amcMonthlyCost: Number(v) })} />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRenewFor(null)}>Cancel</Button>
              <Button disabled={doRenew.isPending} onClick={() => doRenew.mutate()}>Renew</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}

function Num({ label, value, onChange, type = 'number' }: { label: string; value: string | number; onChange: (v: string | number) => void; type?: string }) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground">{label}</label>
      <Input type={type} min={0} value={value} onChange={(e) => onChange(e.target.value)} className="h-8" />
    </div>
  );
}
