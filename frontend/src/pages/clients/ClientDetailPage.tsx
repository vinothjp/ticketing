import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Plus, ChevronRight, Users, RefreshCw } from 'lucide-react';
import api from '../../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import ProductIcon from '@/components/ProductIcon';
import ConsultantGrid from '@/components/ConsultantGrid';
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
  scope: 'PRODUCT' | 'CUSTOMER'; coverageType: 'WARRANTY' | 'AMC'; start: string | null; end: string | null; hours: number | null; visits: number | null; monthlyCost: number | null;
  productIds: string[]; period: { pct: number; daysLeft: number | null; active: boolean }; hoursPool: CPool; visitsPool: CPool;
}
interface Consultant { id: string; userId: string; username: string | null; productId: string | null; moduleId: string | null; track: string | null; isPrimary?: boolean }
interface CatAgent { track: string; user: { id: string; username: string } }
interface CatModule { id: string; name: string; consultants: CatAgent[] }
interface CatProduct { id: string; name: string; imageUrl?: string | null; modules: CatModule[]; consultants: CatAgent[] }
interface StaffUser { id: string; username: string }

const today = () => new Date().toISOString().slice(0, 10);
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

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['client-products', companyId] });
    qc.invalidateQueries({ queryKey: ['client-contract', companyId] });
    qc.invalidateQueries({ queryKey: ['client-consultants', companyId] });
  };
  const run = async (p: Promise<unknown>, ok?: string) => { try { await p; invalidate(); if (ok) toast.success(ok); } catch (e: any) { toast.error(e.response?.data?.message || 'Error'); } };

  // ---- contract scope ----
  const [scope, setScope] = useState<'PRODUCT' | 'CUSTOMER'>('PRODUCT');
  const num = (n: number | null): number | '' => (n == null ? '' : n);
  const [cust, setCust] = useState({ coverageType: 'AMC' as 'WARRANTY' | 'AMC', productIds: [] as string[], start: today(), end: '', hours: '' as number | '', visits: '' as number | '', monthlyCost: '' as number | '' });
  useEffect(() => {
    if (contract) {
      setScope(contract.scope);
      setCust({ coverageType: contract.coverageType ?? 'AMC', productIds: contract.productIds, start: contract.start?.slice(0, 10) ?? today(), end: contract.end?.slice(0, 10) ?? '', hours: num(contract.hours), visits: num(contract.visits), monthlyCost: num(contract.monthlyCost) });
    }
  }, [contract]);
  const onScope = (v: string) => { const s = v as 'PRODUCT' | 'CUSTOMER'; setScope(s); if (s === 'PRODUCT') run(api.put(`/api/customer-companies/${companyId}/product-contract`, { scope: 'PRODUCT' })); };
  const saveCustomer = () => {
    if (cust.start && cust.end && cust.end <= cust.start) { toast.error('End date must be after the start date'); return; }
    run(api.put(`/api/customer-companies/${companyId}/product-contract`, {
      scope: 'CUSTOMER', coverageType: cust.coverageType, start: cust.start || undefined, end: cust.end || undefined,
      hours: cust.hours === '' ? undefined : Number(cust.hours), visits: cust.visits === '' ? undefined : Number(cust.visits),
      // Warranty is free — a contract amount only belongs to a paid AMC.
      monthlyCost: cust.coverageType !== 'AMC' || cust.monthlyCost === '' ? undefined : Number(cust.monthlyCost),
      productIds: cust.productIds,
    }), 'Contract saved');
  };
  // A contract amount only applies to a paid AMC; a warranty period is free.
  const paidCoverage = cust.coverageType === 'AMC';
  // Renew — enabled only in the last 30 days before expiry (or once expired).
  const canRenew = !!contract?.end && (!contract.period.active || (contract.period.daysLeft ?? 999) <= 30);
  const [renewOpen, setRenewOpen] = useState(false);
  const [renew, setRenew] = useState({ months: 12, hours: '' as number | '', visits: '' as number | '', monthlyCost: '' as number | '' });
  const doRenew = () => run(api.post(`/api/customer-companies/${companyId}/contract-renew`, {
    months: Number(renew.months),
    hours: renew.hours === '' ? undefined : Number(renew.hours),
    visits: renew.visits === '' ? undefined : Number(renew.visits),
    monthlyCost: cust.coverageType !== 'AMC' || renew.monthlyCost === '' ? undefined : Number(renew.monthlyCost),
  }), 'Contract renewed').then(() => setRenewOpen(false));

  // ---- contract consultants (common team for the whole customer contract) ----
  const contractConsultants = consultants.filter((c) => !c.productId && !c.moduleId);
  const addContractConsultant = (_moduleId: string | null, col: string, userId: string) =>
    run(api.post(`/api/customer-companies/${companyId}/consultants`, { userId, track: col === 'OTHERS' ? undefined : col }), 'Consultant assigned');
  const removeConsultant = (id: string) => run(api.delete(`/api/customer-companies/consultants/${id}`));
  const setPrimaryConsultant = (id: string) => run(api.put(`/api/customer-companies/consultants/${id}/primary`, {}));

  const logoOf = (pid: string) => catalog.find((c) => c.id === pid)?.imageUrl;
  // Default-consultant dropdown offers only agents assigned (in the Products screen)
  // to any product this customer has.
  const clientProductAgents = (() => {
    const byId = new Map<string, StaffUser>();
    for (const pp of products) {
      const cat = catalog.find((c) => c.id === pp.productId);
      for (const m of cat?.modules ?? []) for (const a of m.consultants ?? []) byId.set(a.user.id, a.user);
      for (const a of cat?.consultants ?? []) byId.set(a.user.id, a.user);
    }
    return [...byId.values()];
  })();

  return (
    <div>
      <Button variant="ghost" size="sm" onClick={() => navigate('/admin/customer-companies')} className="mb-3 -ml-2"><ArrowLeft className="size-4" /> All clients</Button>
      <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-2xl font-bold text-foreground">{client?.name ?? 'Client'}</h1>
        {client?.code && <span className="text-sm text-muted-foreground">{client.code}</span>}
        {client && <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${statusCls(client.status)}`}>{client.status.toLowerCase()}</span>}
        <div className="ml-auto flex items-center gap-4">
          <span className="text-sm font-medium text-muted-foreground">Contract type</span>
          <RadioGroup value={scope} onValueChange={onScope} className="flex gap-5">
            <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="PRODUCT" /> Per product</label>
            <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="CUSTOMER" /> One customer contract</label>
          </RadioGroup>
        </div>
      </div>

      {/* Customer-contract terms (only in customer-contract mode) */}
      {scope === 'CUSTOMER' && (
        <section className="mb-6 space-y-8">
          {/* Contract terms — shared dates + pool */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-foreground">Contract terms</h3>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={!canRenew}
                  title={canRenew ? undefined : 'Available within 30 days of expiry'}
                  onClick={() => { setRenew({ months: 12, hours: num(contract?.hours ?? null), visits: num(contract?.visits ?? null), monthlyCost: num(contract?.monthlyCost ?? null) }); setRenewOpen(true); }}>
                  <RefreshCw className="size-4" /> Renew AMC
                </Button>
                <Button size="sm" disabled={cust.productIds.length === 0} onClick={saveCustomer}>Save contract</Button>
              </div>
            </div>
            <RadioGroup value={cust.coverageType} onValueChange={(v) => setCust({ ...cust, coverageType: v as 'WARRANTY' | 'AMC' })} className="flex gap-5">
              <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="WARRANTY" /> Under warranty <span className="text-xs text-muted-foreground">(free)</span></label>
              <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="AMC" /> Under AMC <span className="text-xs text-muted-foreground">(paid)</span></label>
            </RadioGroup>
            <div className={cn('grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-3', paidCoverage ? 'lg:grid-cols-5' : 'lg:grid-cols-4')}>
              <Field label="Start date" type="date" value={cust.start} onChange={(v) => setCust({ ...cust, start: v })} />
              <Field label="End date" type="date" min={cust.start || undefined} value={cust.end} onChange={(v) => setCust({ ...cust, end: v })} />
              <Field label="Hours" value={cust.hours} onChange={(v) => setCust({ ...cust, hours: v === '' ? '' : Number(v) })} />
              <Field label="Visits" value={cust.visits} onChange={(v) => setCust({ ...cust, visits: v === '' ? '' : Number(v) })} />
              {paidCoverage && (
                <Field label="Contract amount" value={cust.monthlyCost} onChange={(v) => setCust({ ...cust, monthlyCost: v === '' ? '' : Number(v) })} />
              )}
            </div>
          </div>

          {/* Products covered — only the products this customer has */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Products covered</h3>
            {products.length === 0 ? (
              <p className="text-sm text-muted-foreground">No products yet — switch to Per product to assign one.</p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {products.map((p) => {
                  const selected = cust.productIds.includes(p.productId);
                  const toggle = () => setCust((s) => ({ ...s, productIds: selected ? s.productIds.filter((x) => x !== p.productId) : [...s.productIds, p.productId] }));
                  return (
                    <div key={p.id} role="button" tabIndex={0}
                      onClick={() => navigate(`/admin/clients/${companyId}/products/${p.id}?view=consultants`)}
                      className={cn('flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                        selected ? 'border-primary bg-primary/5' : 'hover:border-primary/50 hover:bg-muted/40')}>
                      <ProductIcon imageUrl={logoOf(p.productId)} className="size-11" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-semibold text-foreground">{p.productName}</span>
                          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusCls(p.status)}`}>{p.status.toLowerCase()}</span>
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">Primary agents: {p.agents.length ? p.agents.join(', ') : 'none'}</div>
                        <div className="mt-1 text-[11px] font-medium text-primary">Manage consultants →</div>
                      </div>
                      <span onClick={(e) => e.stopPropagation()} className="mt-0.5 shrink-0" title={selected ? 'Remove from contract' : 'Add to contract'}>
                        <Checkbox checked={selected} onCheckedChange={toggle} />
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Per-product management (only in per-product mode) */}
      {scope === 'PRODUCT' && (
      <section className="mb-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-foreground">Products</h2>
          <Button size="sm" onClick={() => navigate(`/admin/clients/${companyId}/assign`)}><Plus className="size-3.5" /> Assign a product</Button>
        </div>
        {products.length === 0 ? <p className="text-sm text-muted-foreground">No products yet — use “Assign a product”.</p> : (
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
                  <div className="mt-0.5 text-xs text-muted-foreground">Primary agents: {p.agents.length ? p.agents.join(', ') : 'none'}</div>
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>
        )}
      </section>
      )}

      {/* The client's common team. One shared set whatever the contract scope —
          per-product overrides live on the product page. */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-1.5 text-base font-semibold text-foreground"><Users className="size-4" /> Default consultants</h2>
        <p className="text-sm text-muted-foreground">Route this client’s tickets to these agents for every product, unless that product has its own consultant assigned.</p>
        <ConsultantGrid modules={[]} consultants={contractConsultants} staff={clientProductAgents} onAdd={addContractConsultant} onRemove={removeConsultant} onPrimary={setPrimaryConsultant} emptyRowLabel="All products" />
      </section>


      {/* Renew — extends the contract from its current end date by N months and
          resets the hours/visits pools for the new term. */}
      <Dialog open={renewOpen} onOpenChange={setRenewOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Renew contract</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <Field label="Extend by (months)" value={renew.months} min={1}
              onChange={(v) => setRenew({ ...renew, months: Number(v) })} />
            <Field label="Support hours" value={renew.hours}
              onChange={(v) => setRenew({ ...renew, hours: v === '' ? '' : Number(v) })} />
            <Field label="Visits" value={renew.visits}
              onChange={(v) => setRenew({ ...renew, visits: v === '' ? '' : Number(v) })} />
            {paidCoverage && (
              <Field label="Monthly cost" value={renew.monthlyCost}
                onChange={(v) => setRenew({ ...renew, monthlyCost: v === '' ? '' : Number(v) })} />
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenewOpen(false)}>Cancel</Button>
            <Button onClick={doRenew} disabled={!renew.months || renew.months < 1}>Renew</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
