import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, ShieldCheck, Wrench, Clock, MapPin, RefreshCw, Trash2, Users, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import api from '../../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import ProductIcon from '@/components/ProductIcon';

interface Pool { allocated: number | null; used: number; left: number | null }
interface Cov { end: string | null; label: string; pct: number; active: boolean }
interface Purchased {
  id: string; productId: string; productName: string; productCode: string; status: string; purchaseDate: string | null; agents: string[];
  warranty: Cov & { months: number }; amc: Cov & { start: string | null; type: 'FREE' | 'PAID'; freeMonths: number };
  hours: Pool; visits: Pool;
  paidTerms: { months: number | null; monthlyCost: number | null; hours: number | null; visits: number | null };
}
interface Consultant { id: string; userId: string; username: string | null; productId: string | null; moduleId: string | null; track: string | null }
interface CatModule { id: string; name: string; tracks: string[] }
interface CatProduct { id: string; name: string; imageUrl?: string | null; modules: CatModule[] }
interface StaffUser { id: string; username: string }

const CCOLS = [
  { key: 'TECHNICAL', label: 'Technical' },
  { key: 'FUNCTIONAL', label: 'Functional' },
  { key: 'OTHERS', label: 'Others' },
] as const;

const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString() : '—');
const inr = (n: number | null) => (n == null ? '—' : `₹${n.toLocaleString('en-IN')}`);
const statusCls = (s: string) =>
  s === 'ACTIVE' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
  : s === 'EXPIRED' ? 'bg-destructive/15 text-destructive border-destructive/30'
  : 'bg-muted text-muted-foreground border-border';

function Meter({ icon, title, subtitle, pct, active, right }: { icon: React.ReactNode; title: string; subtitle: string; pct: number; active: boolean; right?: string }) {
  const warn = active && pct >= 85;
  return (
    <div className="space-y-1.5 rounded-lg border p-3">
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-1.5 font-medium text-foreground">{icon} {title}</span>
        <span className={cn('text-xs', !active ? 'text-destructive' : warn ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground')}>{right ?? (active ? '' : 'Ended')}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full rounded-full', !active ? 'bg-destructive' : warn ? 'bg-amber-500' : 'bg-primary')} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <div className="text-xs text-muted-foreground">{subtitle}</div>
    </div>
  );
}
function Num({ label, value, onChange, type = 'number', min }: { label: string; value: string | number; onChange: (v: string) => void; type?: string; min?: string | number }) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground">{label}</label>
      <Input type={type} min={min ?? (type === 'number' ? 0 : undefined)} value={value} onChange={(e) => onChange(e.target.value)} className="h-8" />
    </div>
  );
}

export default function ClientProductPage() {
  const { companyId, cpId } = useParams<{ companyId: string; cpId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: company } = useQuery<{ name: string }>({ queryKey: ['client', companyId], queryFn: async () => (await api.get(`/api/customer-companies/${companyId}`)).data });
  const { data: products = [] } = useQuery<Purchased[]>({ queryKey: ['client-products', companyId], queryFn: async () => (await api.get(`/api/customer-companies/${companyId}/purchased-products`)).data });
  const { data: consultants = [] } = useQuery<Consultant[]>({ queryKey: ['client-consultants', companyId], queryFn: async () => (await api.get(`/api/customer-companies/${companyId}/consultants`)).data });
  const { data: catalog = [] } = useQuery<CatProduct[]>({ queryKey: ['products'], queryFn: async () => (await api.get('/api/products')).data });
  const { data: staff = [] } = useQuery<StaffUser[]>({ queryKey: ['users'], queryFn: async () => (await api.get('/api/users')).data });

  const cp = products.find((p) => p.id === cpId);
  const cat = catalog.find((c) => c.id === cp?.productId);
  const productConsultants = consultants.filter((c) => c.productId === cp?.productId);

  const [terms, setTerms] = useState({ coverageType: 'WARRANTY' as 'WARRANTY' | 'AMC', startDate: '', endDate: '', supportHours: 0, visits: 0, contractAmount: 0 });
  useEffect(() => {
    if (cp) setTerms({
      coverageType: cp.amc.type === 'FREE' ? 'WARRANTY' : 'AMC',
      startDate: cp.amc.start ? cp.amc.start.slice(0, 10) : '',
      endDate: cp.amc.end ? cp.amc.end.slice(0, 10) : '',
      supportHours: cp.hours.allocated ?? 0,
      visits: cp.visits.allocated ?? 0,
      contractAmount: cp.paidTerms.monthlyCost ?? 0,
    });
  }, [cp]);

  const invalidate = () => { qc.invalidateQueries({ queryKey: ['client-products', companyId] }); qc.invalidateQueries({ queryKey: ['client-consultants', companyId] }); };
  const run = async (p: Promise<unknown>, ok?: string) => { try { await p; invalidate(); if (ok) toast.success(ok); } catch (e: any) { toast.error(e.response?.data?.message || 'Error'); } };

  const saveTerms = () => {
    if (terms.startDate && terms.endDate && terms.endDate <= terms.startDate) { toast.error('End date must be after the start date'); return; }
    run(api.patch(`/api/customer-companies/purchased-products/${cpId}`, {
      coverageType: terms.coverageType,
      startDate: terms.startDate || undefined,
      endDate: terms.endDate || undefined,
      supportHours: Number(terms.supportHours),
      visits: Number(terms.visits),
      ...(terms.coverageType === 'AMC' ? { contractAmount: Number(terms.contractAmount) } : {}),
    }), 'Terms saved');
  };

  const [renewOpen, setRenewOpen] = useState(false);
  const [renew, setRenew] = useState({ months: 12, amcMonthlyCost: 0 });
  const doRenew = useMutation({
    mutationFn: () => api.post(`/api/customer-companies/purchased-products/${cpId}/renew`, { months: renew.months, amcMonthlyCost: renew.amcMonthlyCost }),
    onSuccess: () => { invalidate(); setRenewOpen(false); toast.success('AMC renewed'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  });
  const doRemove = () => run(api.delete(`/api/customer-companies/purchased-products/${cpId}`), 'Product removed').then(() => navigate(`/admin/clients/${companyId}`));

  // consultants for this product — grid of Module × Technical / Functional / Others
  const removeConsultant = (id: string) => run(api.delete(`/api/customer-companies/consultants/${id}`));
  const addConsultant = (moduleId: string | null, col: string, userId: string) =>
    run(api.post(`/api/customer-companies/${companyId}/consultants`, {
      userId, productId: cp!.productId, moduleId: moduleId || undefined,
      track: col === 'OTHERS' ? undefined : col,
    }), 'Consultant assigned');

  if (!cp) return <p className="text-muted-foreground">Loading…</p>;
  // Rows: one per module when the product is split into modules; otherwise a single
  // "Whole product" row for a module-less product.
  const rows = (cat?.modules?.length ?? 0) > 0
    ? cat!.modules.map((m) => ({ key: m.id, name: m.name, moduleId: m.id as string | null }))
    : [{ key: '__product', name: 'Whole product', moduleId: null as string | null }];
  const inCell = (moduleId: string | null, colKey: string) =>
    productConsultants.filter((c) => c.moduleId === moduleId && (
      colKey === 'TECHNICAL' ? c.track === 'TECHNICAL'
      : colKey === 'FUNCTIONAL' ? c.track === 'FUNCTIONAL'
      : c.track !== 'TECHNICAL' && c.track !== 'FUNCTIONAL'));

  return (
    <div>
      <Button variant="ghost" size="sm" onClick={() => navigate(`/admin/clients/${companyId}`)} className="mb-3 -ml-2">
        <ArrowLeft className="size-4" /> {company?.name ?? 'Client'} — products
      </Button>

      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <ProductIcon imageUrl={cat?.imageUrl} className="size-14" />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-foreground">{cp.productName}</h1>
            <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${statusCls(cp.status)}`}>{cp.status.toLowerCase()}</span>
          </div>
          <div className="text-sm text-muted-foreground">Purchased {fmt(cp.purchaseDate)}</div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { setRenew({ months: cp.paidTerms.months ?? 12, amcMonthlyCost: cp.paidTerms.monthlyCost ?? 0 }); setRenewOpen(true); }}>
            <RefreshCw className="size-4" /> Renew AMC
          </Button>
          <Button variant="outline" className="text-destructive hover:text-destructive" onClick={doRemove}><Trash2 className="size-4" /> Remove</Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Coverage — one timeline: Warranty (free) → AMC (paid) */}
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-foreground">Coverage</h2>
          <Meter
            icon={cp.amc.type === 'FREE' ? <ShieldCheck className="size-4" /> : <Wrench className="size-4" />}
            title={cp.amc.type === 'FREE' ? 'Warranty (free)' : 'AMC (paid)'}
            subtitle={`ends ${fmt(cp.amc.end)}`} pct={cp.amc.pct} active={cp.amc.active}
            right={cp.amc.active ? cp.amc.label + ' left' : 'Ended'} />
          <Meter icon={<Clock className="size-4" />} title="Support hours" subtitle={cp.hours.allocated == null ? 'Not included' : `${cp.hours.left} of ${cp.hours.allocated} left`} pct={cp.hours.allocated ? Math.round((cp.hours.used / cp.hours.allocated) * 100) : 0} active={(cp.hours.left ?? 0) > 0} right="" />
          <Meter icon={<MapPin className="size-4" />} title="Site visits" subtitle={cp.visits.allocated == null ? 'Not included' : `${cp.visits.left} of ${cp.visits.allocated} left`} pct={cp.visits.allocated ? Math.round((cp.visits.used / cp.visits.allocated) * 100) : 0} active={(cp.visits.left ?? 0) > 0} right="" />
        </section>

        {/* Terms + consultants */}
        <div className="space-y-6">
          <section className="space-y-3">
            <h2 className="text-base font-semibold text-foreground">Terms</h2>
            <RadioGroup value={terms.coverageType} onValueChange={(v) => setTerms({ ...terms, coverageType: v as 'WARRANTY' | 'AMC' })} className="flex gap-5">
              <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="WARRANTY" /> Under warranty <span className="text-xs text-muted-foreground">(free)</span></label>
              <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="AMC" /> Under AMC <span className="text-xs text-muted-foreground">(paid)</span></label>
            </RadioGroup>
            <div className="grid max-w-lg grid-cols-2 gap-2">
              <Num label="Start date" type="date" value={terms.startDate} onChange={(v) => setTerms({ ...terms, startDate: v })} />
              <Num label="End date" type="date" min={terms.startDate || undefined} value={terms.endDate} onChange={(v) => setTerms({ ...terms, endDate: v })} />
              <Num label="Support hours" value={terms.supportHours} onChange={(v) => setTerms({ ...terms, supportHours: Number(v) })} />
              <Num label="No. of visits" value={terms.visits} onChange={(v) => setTerms({ ...terms, visits: Number(v) })} />
              {terms.coverageType === 'AMC' && (
                <Num label="Contract amount" value={terms.contractAmount} onChange={(v) => setTerms({ ...terms, contractAmount: Number(v) })} />
              )}
            </div>
            <Button size="sm" onClick={saveTerms}>Save terms</Button>
          </section>
        </div>
      </div>

      {/* Consultants — full-width grid of Module × Technical / Functional / Others */}
      <section className="mt-8 space-y-3">
        <h2 className="flex items-center gap-1.5 text-base font-semibold text-foreground"><Users className="size-4" /> Consultants for this product</h2>
        <p className="text-sm text-muted-foreground">Route this client's tickets per module and track. Type a name to assign. Empty cells fall back to the module's default routing.</p>
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-muted/50 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <th className="w-44 border-b px-3 py-2">Module</th>
                {CCOLS.map((c) => <th key={c.key} className="border-b border-l px-3 py-2">{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="align-top">
                  <td className="border-b px-3 py-2 font-medium text-foreground">{row.name}</td>
                  {CCOLS.map((c) => {
                    const list = inCell(row.moduleId, c.key);
                    const taken = new Set(list.map((a) => a.userId));
                    return (
                      <td key={c.key} className="border-b border-l px-2 py-2 align-top">
                        <div className="space-y-1">
                          {list.map((a) => (
                            <div key={a.id} className="group flex items-center gap-1 rounded bg-muted px-1.5 py-1 text-xs">
                              <span className="flex-1 truncate text-foreground">{a.username}</span>
                              <button className="shrink-0 text-muted-foreground hover:text-destructive" onClick={() => removeConsultant(a.id)}><X className="size-3" /></button>
                            </div>
                          ))}
                          <ConsultantTypeahead staff={staff} exclude={taken} onPick={(uid) => addConsultant(row.moduleId, c.key, uid)} />
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Dialog open={renewOpen} onOpenChange={setRenewOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Renew AMC — {cp.productName}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Starts a paid AMC period from today and refreshes the hours/visits pool.</p>
          <div className="grid grid-cols-2 gap-3">
            <Num label="Months" value={renew.months} onChange={(v) => setRenew({ ...renew, months: Number(v) })} />
            <Num label="₹/month" value={renew.amcMonthlyCost} onChange={(v) => setRenew({ ...renew, amcMonthlyCost: Number(v) })} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenewOpen(false)}>Cancel</Button>
            <Button disabled={doRenew.isPending} onClick={() => doRenew.mutate()}>Renew</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Type-to-search agent picker for a grid cell (mirrors the product editor).
function ConsultantTypeahead({ staff, exclude, onPick }: { staff: StaffUser[]; exclude: Set<string>; onPick: (userId: string) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const matches = staff.filter((u) => !exclude.has(u.id) && u.username.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 8);
  return (
    <div className="relative">
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="+ type agent…"
        className="h-7 w-full rounded border border-input bg-background px-2 text-xs outline-none focus:border-primary"
      />
      {open && matches.length > 0 && (
        <div className="absolute left-0 top-full z-30 mt-1 max-h-48 w-full min-w-36 overflow-y-auto rounded-md border bg-popover shadow-md">
          {matches.map((u) => (
            <button key={u.id} className="block w-full truncate px-2 py-1.5 text-left text-xs hover:bg-muted" onMouseDown={(e) => { e.preventDefault(); onPick(u.id); setQ(''); }}>
              {u.username}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
