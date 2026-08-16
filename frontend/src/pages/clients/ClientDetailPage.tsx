import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Plus, Trash2, ChevronRight, Users, Boxes } from 'lucide-react';
import api from '../../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import ProductIcon from '@/components/ProductIcon';
import { cn } from '@/lib/utils';

interface Pool { allocated: number | null; used: number; left: number | null }
interface Cov { end: string | null; label: string; pct: number; active: boolean }
interface Purchased {
  id: string; productId: string; productName: string; productCode: string; status: string; agents: string[];
  warranty: Cov & { months: number }; amc: Cov & { type: 'FREE' | 'PAID' }; hours: Pool; visits: Pool;
}
interface Client { id: string; name: string; code: string | null; status: string }
interface CPool { allocated: number | null; used: number; left: number | null }
interface Contract {
  scope: 'PRODUCT' | 'CUSTOMER'; start: string | null; end: string | null; hours: number | null; visits: number | null; monthlyCost: number | null;
  productIds: string[]; period: { pct: number; daysLeft: number | null; active: boolean }; hoursPool: CPool; visitsPool: CPool;
}
interface Consultant { id: string; userId: string; username: string | null; productId: string | null; moduleId: string | null; track: string | null }
interface CatProduct { id: string; name: string; imageUrl?: string | null }
interface StaffUser { id: string; username: string }

const today = () => new Date().toISOString().slice(0, 10);
const monthsFromNow = (m: number) => { const d = new Date(); d.setMonth(d.getMonth() + m); return d.toISOString().slice(0, 10); };
const fmtD = (d: string | null) => (d ? new Date(d).toLocaleDateString() : '—');
const statusCls = (s: string) =>
  s === 'ACTIVE' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
  : s === 'EXPIRED' ? 'bg-destructive/15 text-destructive border-destructive/30'
  : 'bg-muted text-muted-foreground border-border';

export default function ClientDetailPage() {
  const { companyId } = useParams<{ companyId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: client } = useQuery<Client>({ queryKey: ['client', companyId], queryFn: async () => (await api.get(`/api/customer-companies/${companyId}`)).data });
  const { data: products = [] } = useQuery<Purchased[]>({ queryKey: ['client-products', companyId], queryFn: async () => (await api.get(`/api/customer-companies/${companyId}/purchased-products`)).data });
  const { data: contract } = useQuery<Contract>({ queryKey: ['client-contract', companyId], queryFn: async () => (await api.get(`/api/customer-companies/${companyId}/product-contract`)).data });
  const { data: consultants = [] } = useQuery<Consultant[]>({ queryKey: ['client-consultants', companyId], queryFn: async () => (await api.get(`/api/customer-companies/${companyId}/consultants`)).data });
  const { data: catalog = [] } = useQuery<CatProduct[]>({ queryKey: ['products'], queryFn: async () => (await api.get('/api/products')).data });
  const { data: staff = [] } = useQuery<StaffUser[]>({ queryKey: ['users'], queryFn: async () => (await api.get('/api/users')).data });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['client-products', companyId] });
    qc.invalidateQueries({ queryKey: ['client-contract', companyId] });
    qc.invalidateQueries({ queryKey: ['client-consultants', companyId] });
  };
  const run = async (p: Promise<unknown>, ok?: string) => { try { await p; invalidate(); if (ok) toast.success(ok); } catch (e: any) { toast.error(e.response?.data?.message || 'Error'); } };

  // ---- contract scope ----
  const [scope, setScope] = useState<'PRODUCT' | 'CUSTOMER'>('PRODUCT');
  const num = (n: number | null): number | '' => (n == null ? '' : n);
  const [cust, setCust] = useState({ productIds: [] as string[], start: today(), end: '', hours: '' as number | '', visits: '' as number | '', monthlyCost: '' as number | '' });
  useEffect(() => {
    if (contract) {
      setScope(contract.scope);
      setCust({ productIds: contract.productIds, start: contract.start?.slice(0, 10) ?? today(), end: contract.end?.slice(0, 10) ?? '', hours: num(contract.hours), visits: num(contract.visits), monthlyCost: num(contract.monthlyCost) });
    }
  }, [contract]);
  const onScope = (v: string) => { const s = v as 'PRODUCT' | 'CUSTOMER'; setScope(s); if (s === 'PRODUCT') run(api.put(`/api/customer-companies/${companyId}/product-contract`, { scope: 'PRODUCT' })); };
  const saveCustomer = () => {
    if (cust.start && cust.end && cust.end <= cust.start) { toast.error('End date must be after the start date'); return; }
    run(api.put(`/api/customer-companies/${companyId}/product-contract`, {
      scope: 'CUSTOMER', start: cust.start || undefined, end: cust.end || undefined,
      hours: cust.hours === '' ? undefined : Number(cust.hours), visits: cust.visits === '' ? undefined : Number(cust.visits),
      monthlyCost: cust.monthlyCost === '' ? undefined : Number(cust.monthlyCost), productIds: cust.productIds,
    }), 'Contract saved');
  };

  // Renew against the shared pool. (Usage logging moves to a dedicated submodule.)
  const [renew, setRenew] = useState({ months: 12, hours: '', visits: '' });
  const doRenew = () => run(api.post(`/api/customer-companies/${companyId}/contract-renew`, { months: Number(renew.months), hours: renew.hours === '' ? undefined : Number(renew.hours), visits: renew.visits === '' ? undefined : Number(renew.visits) }), 'Contract renewed');

  // ---- assign product ----
  const owned = new Set(products.map((p) => p.productId));
  const assignable = catalog.filter((c) => !owned.has(c.id));
  const [assign, setAssign] = useState<{ productId: string; coverageType: 'WARRANTY' | 'AMC'; startDate: string; endDate: string; supportHours: number; visits: number; contractAmount: number }>({ productId: '', coverageType: 'WARRANTY', startDate: today(), endDate: monthsFromNow(12), supportHours: 100, visits: 4, contractAmount: 100000 });
  const doAssign = () => {
    if (assign.startDate && assign.endDate && assign.endDate <= assign.startDate) { toast.error('End date must be after the start date'); return; }
    run(api.post(`/api/customer-companies/${companyId}/purchased-products`, {
      productId: assign.productId, coverageType: assign.coverageType,
      startDate: assign.startDate, endDate: assign.endDate,
      supportHours: assign.supportHours, visits: assign.visits,
      ...(assign.coverageType === 'AMC' ? { contractAmount: assign.contractAmount } : {}),
    }), 'Product assigned').then(() => setAssign((a) => ({ ...a, productId: '' })));
  };

  // ---- default consultants (no product) ----
  const defaults = consultants.filter((c) => !c.productId);
  const [defUser, setDefUser] = useState('');
  const addDefault = () => run(api.post(`/api/customer-companies/${companyId}/consultants`, { userId: defUser }), 'Default consultant set').then(() => setDefUser(''));
  const removeConsultant = (id: string) => run(api.delete(`/api/customer-companies/consultants/${id}`));

  const logoOf = (pid: string) => catalog.find((c) => c.id === pid)?.imageUrl;

  return (
    <div>
      <Button variant="ghost" size="sm" onClick={() => navigate('/admin/customer-companies')} className="mb-3 -ml-2"><ArrowLeft className="size-4" /> All clients</Button>
      <div className="mb-6 flex items-center gap-3">
        <h1 className="text-2xl font-bold text-foreground">{client?.name ?? 'Client'}</h1>
        {client?.code && <span className="text-sm text-muted-foreground">{client.code}</span>}
        {client && <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${statusCls(client.status)}`}>{client.status.toLowerCase()}</span>}
      </div>

      {/* Contract type */}
      <section className="mb-8 space-y-3 border-b pb-6">
        <div className="text-sm font-medium">Contract type</div>
        <RadioGroup value={scope} onValueChange={onScope} className="flex flex-wrap gap-6">
          <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="PRODUCT" /> Per product <span className="text-xs text-muted-foreground">(each product its own AMC)</span></label>
          <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="CUSTOMER" /> One customer contract <span className="text-xs text-muted-foreground">(shared dates + hours)</span></label>
        </RadioGroup>

        {scope === 'CUSTOMER' && (
          <div className="space-y-6 pt-3">
            {/* Live shared pool */}
            {contract && contract.hours != null && (
              <div className="space-y-4">
                <div className="grid gap-5 sm:grid-cols-3">
                  <PoolBar label="Contract period" main={contract.period.active ? `${contract.period.daysLeft} days left` : 'Ended'} sub={`${fmtD(contract.start)} → ${fmtD(contract.end)}`} pct={contract.period.pct} active={contract.period.active} />
                  <PoolBar label="Support hours" main={contract.hoursPool.left == null ? '—' : `${contract.hoursPool.left} left`} sub={contract.hoursPool.allocated == null ? '' : `${contract.hoursPool.used} of ${contract.hoursPool.allocated} used`} pct={contract.hoursPool.allocated ? Math.round((contract.hoursPool.used / contract.hoursPool.allocated) * 100) : 0} active={(contract.hoursPool.left ?? 0) > 0} />
                  <PoolBar label="Site visits" main={contract.visitsPool.left == null ? '—' : `${contract.visitsPool.left} left`} sub={contract.visitsPool.allocated == null ? '' : `${contract.visitsPool.used} of ${contract.visitsPool.allocated} used`} pct={contract.visitsPool.allocated ? Math.round((contract.visitsPool.used / contract.visitsPool.allocated) * 100) : 0} active={(contract.visitsPool.left ?? 0) > 0} />
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <Field label="Renew months" value={renew.months} onChange={(v) => setRenew({ ...renew, months: Number(v) })} />
                  <Field label="New hours" value={renew.hours} onChange={(v) => setRenew({ ...renew, hours: v })} />
                  <Field label="New visits" value={renew.visits} onChange={(v) => setRenew({ ...renew, visits: v })} />
                  <Button size="sm" variant="outline" onClick={doRenew}>Renew contract</Button>
                </div>
              </div>
            )}

            {/* Setup / edit terms */}
            <div className="space-y-3">
              <div className="text-sm font-medium">Contract terms</div>
              <div className="text-xs text-muted-foreground">Products covered by this contract</div>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {catalog.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={cust.productIds.includes(c.id)} onCheckedChange={() => setCust((s) => ({ ...s, productIds: s.productIds.includes(c.id) ? s.productIds.filter((x) => x !== c.id) : [...s.productIds, c.id] }))} />
                    {c.name}
                  </label>
                ))}
              </div>
              <div className="grid max-w-3xl grid-cols-5 gap-3">
                <Field label="Start date" type="date" value={cust.start} onChange={(v) => setCust({ ...cust, start: v })} />
                <Field label="End date" type="date" min={cust.start || undefined} value={cust.end} onChange={(v) => setCust({ ...cust, end: v })} />
                <Field label="Hours" value={cust.hours} onChange={(v) => setCust({ ...cust, hours: v === '' ? '' : Number(v) })} />
                <Field label="Visits" value={cust.visits} onChange={(v) => setCust({ ...cust, visits: v === '' ? '' : Number(v) })} />
                <Field label="₹/month" value={cust.monthlyCost} onChange={(v) => setCust({ ...cust, monthlyCost: v === '' ? '' : Number(v) })} />
              </div>
              <Button size="sm" disabled={cust.productIds.length === 0} onClick={saveCustomer}>Save contract</Button>
            </div>
          </div>
        )}
      </section>

      {/* Per-product management (only in per-product mode) */}
      {scope === 'PRODUCT' && (
      <section className="mb-8 space-y-4 border-b pb-6">
        <h2 className="text-base font-semibold text-foreground">Products</h2>
        {products.length === 0 ? <p className="text-sm text-muted-foreground">No products yet — assign one below.</p> : (
          <div className="grid gap-3 md:grid-cols-2">
            {products.map((p) => (
              <button key={p.id} onClick={() => navigate(`/admin/clients/${companyId}/products/${p.id}`)}
                className="flex items-center gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:border-primary/50 hover:bg-muted/40">
                <ProductIcon imageUrl={logoOf(p.productId)} className="size-11" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold text-foreground">{p.productName}</span>
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusCls(p.status)}`}>{p.status.toLowerCase()}</span>
                  </div>
                  <div className="mt-0.5 grid grid-cols-2 gap-x-3 text-xs text-muted-foreground">
                    <span>{p.amc.type === 'FREE' ? 'Warranty (free)' : 'AMC (paid)'}: {p.amc.active ? p.amc.label : 'ended'}</span>
                    <span>Hours: {p.hours.allocated == null ? '—' : `${p.hours.left}/${p.hours.allocated}`}</span>
                    <span>Visits: {p.visits.allocated == null ? '—' : `${p.visits.left}/${p.visits.allocated}`}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">Agents: {p.agents.length ? p.agents.join(', ') : 'none'}</div>
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>
        )}

        {/* Assign a product */}
        <div className="space-y-3 pt-2">
          <div className="text-sm font-medium">Assign a product</div>
          <Select value={assign.productId} onValueChange={(v) => setAssign({ ...assign, productId: v })}>
            <SelectTrigger className="max-w-sm"><SelectValue placeholder="Choose a product" /></SelectTrigger>
            <SelectContent>{assignable.length === 0 ? <SelectItem value="__none" disabled>All products assigned</SelectItem> : assignable.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
          </Select>
          <RadioGroup value={assign.coverageType} onValueChange={(v) => setAssign({ ...assign, coverageType: v as 'WARRANTY' | 'AMC' })} className="flex gap-6">
            <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="WARRANTY" /> Under warranty <span className="text-xs text-muted-foreground">(free)</span></label>
            <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="AMC" /> Under AMC <span className="text-xs text-muted-foreground">(paid)</span></label>
          </RadioGroup>
          <div className="grid max-w-2xl grid-cols-2 gap-2">
            <Field label="Start date" type="date" value={assign.startDate} onChange={(v) => setAssign({ ...assign, startDate: v })} />
            <Field label="End date" type="date" min={assign.startDate || undefined} value={assign.endDate} onChange={(v) => setAssign({ ...assign, endDate: v })} />
            <Field label="Support hours" value={assign.supportHours} onChange={(v) => setAssign({ ...assign, supportHours: Number(v) })} />
            <Field label="No. of visits" value={assign.visits} onChange={(v) => setAssign({ ...assign, visits: Number(v) })} />
            {assign.coverageType === 'AMC' && (
              <Field label="Contract amount" value={assign.contractAmount} onChange={(v) => setAssign({ ...assign, contractAmount: Number(v) })} />
            )}
          </div>
          <Button size="sm" disabled={!assign.productId} onClick={doAssign}><Plus className="size-3.5" /> Assign product</Button>
        </div>
      </section>
      )}

      {/* Default consultants */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-1.5 text-base font-semibold text-foreground"><Users className="size-4" /> Default consultants</h2>
        <p className="text-sm text-muted-foreground">Handle this client's tickets when no product-specific consultant matches. Per-product consultants are set on each product's page.</p>
        {defaults.length === 0 ? <p className="text-sm text-muted-foreground">No default consultant.</p> : (
          <div className="divide-y border-y">
            {defaults.map((c) => (
              <div key={c.id} className="flex items-center gap-2 py-2 text-sm">
                <span className="flex-1 font-medium text-foreground">{c.username}</span>
                <Button size="icon" variant="ghost" className="size-7 text-destructive hover:text-destructive" onClick={() => removeConsultant(c.id)}><Trash2 className="size-4" /></Button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <div className="w-56">
            <Select value={defUser} onValueChange={setDefUser}>
              <SelectTrigger className="h-8"><SelectValue placeholder="Choose a consultant" /></SelectTrigger>
              <SelectContent>{staff.map((u) => <SelectItem key={u.id} value={u.id}>{u.username}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Button size="sm" disabled={!defUser} onClick={addDefault}><Plus className="size-3.5" /> Set default</Button>
        </div>
      </section>
    </div>
  );
}

function PoolBar({ label, main, sub, pct, active }: { label: string; main: string; sub: string; pct: number; active: boolean }) {
  const warn = active && pct >= 85;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn('font-semibold', !active ? 'text-destructive' : warn ? 'text-amber-600 dark:text-amber-400' : 'text-foreground')}>{main}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted"><div className={cn('h-full rounded-full', !active ? 'bg-destructive' : warn ? 'bg-amber-500' : 'bg-primary')} style={{ width: `${Math.min(100, pct)}%` }} /></div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Field({ label, value, onChange, type = 'number', min }: { label: string; value: string | number; onChange: (v: string) => void; type?: string; min?: string | number }) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground">{label}</label>
      <Input type={type} min={min ?? (type === 'number' ? 0 : undefined)} value={value} onChange={(e) => onChange(e.target.value)} className="h-8" />
    </div>
  );
}
