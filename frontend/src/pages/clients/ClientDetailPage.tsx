import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Plus, ChevronRight, Users, RefreshCw, ShieldCheck, Wrench, Clock, MapPin } from 'lucide-react';
import api from '../../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import ProductIcon from '@/components/ProductIcon';
import ConsultantGrid from '@/components/ConsultantGrid';
import SupportHoursChoice from '@/components/SupportHoursChoice';
import SupportHoursConfig from '@/components/SupportHoursConfig';
import ExcessHoursApprovals from '@/components/ExcessHoursApprovals';
import { useAuth } from '../../context/AuthContext';
import CoverageMeter from '@/components/CoverageMeter';
import { cn } from '@/lib/utils';

interface Pool { allocated: number | null; used: number; left: number | null }
interface Cov { end: string | null; label: string; pct: number; active: boolean }
interface Purchased {
  id: string; productId: string; productName: string; productCode: string; status: string; agents: string[];
  warranty: Cov & { months: number }; amc: Cov & { type: 'FREE' | 'PAID' }; hours: Pool; visits: Pool;
}
interface Client { id: string; name: string; code: string | null; status: string }
interface CPool { allocated: number | null; used: number; left: number | null; unlimited?: boolean }
interface Support {
  period: 'FULL_AMC' | 'MONTHLY'; carryForward: boolean; allowTicketsAfterHours: boolean; allowExcess: boolean; excessApproval: boolean;
  approverId: string | null; approverName: string | null;
  currentAllocated: number | null; carriedIn: number; currentUsed: number; available: number | null;
}
interface Contract {
  scope: 'PRODUCT' | 'CUSTOMER'; coverageType: 'WARRANTY' | 'AMC'; start: string | null; end: string | null; hoursUnlimited: boolean; hours: number | null; visits: number | null; monthlyCost: number | null;
  productIds: string[]; period: { pct: number; daysLeft: number | null; active: boolean }; hoursPool: CPool; visitsPool: CPool; support?: Support;
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
  const { data: contract, isSuccess: contractLoaded } = useQuery<Contract>({ queryKey: ['client-contract', companyId], queryFn: async () => (await api.get(`/api/customer-companies/${companyId}/product-contract`)).data });
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
  const [cust, setCust] = useState({ coverageType: 'AMC' as 'WARRANTY' | 'AMC', productIds: [] as string[], start: today(), end: '', hoursUnlimited: false, hours: '' as number | '', visits: '' as number | '', monthlyCost: '' as number | '',
    hoursPeriod: 'FULL_AMC' as 'FULL_AMC' | 'MONTHLY', carryForward: false, allowTicketsAfterHours: true, allowExcess: false, excessApproval: false, excessApproverId: '' });
  // Hydrate from the saved contract once it lands. Keyed on the saved *content*,
  // not the object identity: TanStack refetches on window focus, and re-running
  // this for every new object threw away whatever the admin had typed each time
  // they tabbed away and back.
  const contractKey = contract && JSON.stringify([contract.scope, contract.coverageType, contract.start, contract.end, contract.hoursUnlimited, contract.hours, contract.visits, contract.monthlyCost, contract.productIds,
    contract.support?.period, contract.support?.carryForward, contract.support?.allowTicketsAfterHours, contract.support?.allowExcess, contract.support?.excessApproval, contract.support?.approverId]);
  useEffect(() => {
    if (contract) {
      setScope(contract.scope);
      const s = contract.support;
      setCust({ coverageType: contract.coverageType ?? 'AMC', productIds: contract.productIds, start: contract.start?.slice(0, 10) ?? today(), end: contract.end?.slice(0, 10) ?? '', hoursUnlimited: contract.hoursUnlimited ?? false, hours: num(contract.hours), visits: num(contract.visits), monthlyCost: num(contract.monthlyCost),
        hoursPeriod: s?.period ?? 'FULL_AMC', carryForward: s?.carryForward ?? false, allowTicketsAfterHours: s?.allowTicketsAfterHours ?? true, allowExcess: s?.allowExcess ?? false, excessApproval: s?.excessApproval ?? false, excessApproverId: s?.approverId ?? '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractKey]);
  // Warranty is free support, so picking it preselects Unlimited; AMC keeps
  // whatever was already chosen.
  const onCoverage = (v: string) => {
    if (!v) return;
    const coverageType = v as 'WARRANTY' | 'AMC';
    setCust((s) => ({ ...s, coverageType, hoursUnlimited: coverageType === 'WARRANTY' ? true : s.hoursUnlimited }));
  };
  /**
   * Contract type is the one control on this page that writes the moment it is
   * touched, and moving to Per product changes where every ticket hour and client
   * visit draws down — so it is guarded three ways:
   *  - it stays disabled until the saved contract has actually loaded (the page
   *    used to open on Per product regardless of the truth, so a click landing in
   *    that window silently flipped a customer contract to per-product);
   *  - re-picking the option that is already selected is not a change (this
   *    RadioGroup fires onValueChange on every click, checked or not);
   *  - leaving a saved customer contract asks first, and says so afterwards.
   */
  const [pendingScope, setPendingScope] = useState<'PRODUCT' | 'CUSTOMER' | null>(null);
  const onScope = (v: string) => {
    const s = v as 'PRODUCT' | 'CUSTOMER';
    if (!s || !contractLoaded || s === scope) return;
    setPendingScope(s);
  };
  const confirmScope = () => {
    if (!pendingScope) return;
    setScope(pendingScope);
    setPendingScope(null);
    // Confirming IS the change — both directions are written now. The payload
    // carries the scope alone, and `setContract` leaves every term it doesn't
    // carry untouched, so the switch no longer waits on a Save contract press.
    run(
      api.put(`/api/customer-companies/${companyId}/product-contract`, { scope: pendingScope }),
      pendingScope === 'PRODUCT' ? 'Switched to per-product contracts' : 'Switched to one customer contract',
    );
  };
  const saveCustomer = () => {
    if (cust.start && cust.end && cust.end <= cust.start) { toast.error('End date must be after the start date'); return; }
    if (!cust.hoursUnlimited && (cust.hours === '' || Number(cust.hours) <= 0)) { toast.error('Enter support hours greater than 0, or choose Unlimited'); return; }
    // Cleared fields go as explicit `null`, not undefined: the API leaves an
    // absent field alone (that is what makes the bare scope switch safe), so
    // emptying a box here has to say so.
    run(api.put(`/api/customer-companies/${companyId}/product-contract`, {
      scope: 'CUSTOMER', coverageType: cust.coverageType, start: cust.start || null, end: cust.end || null,
      // Unlimited carries no allocation at all.
      hoursUnlimited: cust.hoursUnlimited,
      hours: cust.hoursUnlimited || cust.hours === '' ? null : Number(cust.hours), visits: cust.visits === '' ? null : Number(cust.visits),
      // Warranty is free — a contract amount only belongs to a paid AMC.
      monthlyCost: cust.coverageType !== 'AMC' || cust.monthlyCost === '' ? null : Number(cust.monthlyCost),
      // Support-hours config. Approver cleared → explicit null.
      hoursPeriod: cust.hoursPeriod, carryForward: cust.hoursPeriod === 'MONTHLY' && cust.carryForward,
      allowTicketsAfterHours: cust.allowTicketsAfterHours,
      allowExcess: cust.allowExcess, excessApproval: cust.allowExcess && cust.excessApproval,
      excessApproverId: cust.allowExcess && cust.excessApproval && cust.excessApproverId ? cust.excessApproverId : null,
      productIds: cust.productIds,
    }), 'Contract saved');
  };
  // A contract amount only applies to a paid AMC; a warranty period is free.
  const paidCoverage = cust.coverageType === 'AMC';
  // Support-hours meter figures. In MONTHLY mode they come from this month's
  // ledger (allocation + carried-in, used, available); otherwise the whole-term pool.
  const sup = contract?.support;
  const monthlyHrs = sup?.period === 'MONTHLY' && !contract?.hoursUnlimited;
  const hAlloc = monthlyHrs ? (sup!.currentAllocated ?? 0) + sup!.carriedIn : contract?.hoursPool.allocated ?? null;
  const hUsed = monthlyHrs ? sup!.currentUsed : contract?.hoursPool.used ?? 0;
  const hLeft = monthlyHrs ? sup!.available : contract?.hoursPool.left ?? null;
  const hUnlimited = monthlyHrs ? false : contract?.hoursPool.unlimited ?? false;
  // Consultants reach this screen read-only, to decide an excess-hours request.
  // Every write behind these controls is Admin-only on the API.
  const { user } = useAuth();
  const isAdmin = !!user?.roles.includes('Admin');

  // Renew — enabled only in the last 30 days before expiry (or once expired).
  const canRenew = !!contract?.end && (!contract.period.active || (contract.period.daysLeft ?? 999) <= 30);
  const [renewOpen, setRenewOpen] = useState(false);
  const [renew, setRenew] = useState({ months: 12, hoursUnlimited: false, hours: '' as number | '', visits: '' as number | '', monthlyCost: '' as number | '' });
  const doRenew = () => run(api.post(`/api/customer-companies/${companyId}/contract-renew`, {
    months: Number(renew.months),
    hoursUnlimited: renew.hoursUnlimited,
    hours: renew.hoursUnlimited || renew.hours === '' ? undefined : Number(renew.hours),
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
          <RadioGroup value={scope} onValueChange={onScope} disabled={!contractLoaded || !isAdmin} className="flex gap-5">
            <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="PRODUCT" /> Per product</label>
            <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="CUSTOMER" /> One customer contract</label>
          </RadioGroup>
        </div>
      </div>

      {/* Nothing below is meaningful until we know which contract this client is
          on — rendering the per-product view while the answer is in flight is
          what made a saved customer contract look like it had been changed. */}
      {!contractLoaded && <p className="text-sm text-muted-foreground">Loading contract…</p>}

      {/* Customer-contract mode. Same shape as the per-product screen: the
          products this contract covers across the top, then read-only Coverage
          on the left and the editable Terms on the right. Default consultants
          stay full-width below. */}
      {contractLoaded && scope === 'CUSTOMER' && (
        <section className="mb-6 space-y-6">
          {/* Products covered — only the products this customer has. Assigning one
              works the same in either scope; the shared contract just governs its
              terms, so the button lives here too. */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-foreground">Products covered</h2>
              {isAdmin && <Button size="sm" onClick={() => navigate(`/admin/clients/${companyId}/assign`)}><Plus className="size-3.5" /> Assign a product</Button>}
            </div>
            {products.length === 0 ? (
              <p className="text-sm text-muted-foreground">No products yet — use “Assign a product”.</p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
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

          {/* Coverage — read-only, the three meters across the top. The Terms
              below are what was *agreed*; these meters are what has been drawn
              against it: ticket worklogs and logged usage spend the hours, a
              VISITED client visit spends a visit. Same three as the per-product
              screen. */}
          <section className="space-y-3">
            <h2 className="text-base font-semibold text-foreground">Coverage</h2>
            {!contract ? (
              <p className="text-sm text-muted-foreground">No contract saved yet.</p>
            ) : (
              <div className="grid gap-3 md:grid-cols-3">
                <CoverageMeter
                  icon={contract.coverageType === 'WARRANTY' ? <ShieldCheck className="size-4" /> : <Wrench className="size-4" />}
                  title={contract.coverageType === 'WARRANTY' ? 'Warranty (free)' : 'AMC (paid)'}
                  subtitle={`ends ${fmt(contract.end)}`}
                  pct={contract.end ? contract.period.pct : 0}
                  active={contract.period.active}
                  right={contract.period.active ? timeLeft(contract.period.daysLeft) : 'Ended'} />
                <CoverageMeter icon={<Clock className="size-4" />} title={monthlyHrs ? 'Support hours (this month)' : 'Support hours'}
                  subtitle={hUnlimited
                    ? `Unlimited — ${hUsed} spent`
                    : hAlloc == null
                      ? 'Not included'
                      : `${hLeft} of ${hAlloc} hrs left${monthlyHrs ? ' this month' : ''}`}
                  pct={hAlloc ? Math.round((hUsed / hAlloc) * 100) : 0}
                  active={hUnlimited || (hLeft ?? 0) > 0}
                  right={hUnlimited ? 'Unlimited' : ''} />
                <CoverageMeter icon={<MapPin className="size-4" />} title="Site visits"
                  subtitle={contract.visitsPool.allocated == null ? 'Not included' : `${contract.visitsPool.left} of ${contract.visitsPool.allocated} left`}
                  pct={contract.visitsPool.allocated ? Math.round((contract.visitsPool.used / contract.visitsPool.allocated) * 100) : 0}
                  active={(contract.visitsPool.left ?? 0) > 0} right="" />
              </div>
            )}
          </section>

          {/* Terms (left) and how the hours are governed (right) — both halves
              are written by the one Save contract button below. Admins only;
              consultants see the coverage meters above and the approvals below. */}
          {isAdmin && (
          <>
          <div className="grid gap-6 lg:grid-cols-2">
            <section className="space-y-3">
              <h2 className="text-base font-semibold text-foreground">Terms</h2>
              <RadioGroup value={cust.coverageType} onValueChange={onCoverage} className="flex gap-5">
                <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="WARRANTY" /> Under warranty <span className="text-xs text-muted-foreground">(free)</span></label>
                <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="AMC" /> Under AMC <span className="text-xs text-muted-foreground">(paid)</span></label>
              </RadioGroup>
              <SupportHoursChoice unlimited={cust.hoursUnlimited} onChange={(u) => setCust({ ...cust, hoursUnlimited: u })} />
              <div className="grid grid-cols-2 gap-2">
                <Field label="Start date" type="date" value={cust.start} onChange={(v) => setCust({ ...cust, start: v })} />
                <Field label="End date" type="date" min={cust.start || undefined} value={cust.end} onChange={(v) => setCust({ ...cust, end: v })} />
                {!cust.hoursUnlimited && (
                  <Field label={cust.hoursPeriod === 'MONTHLY' ? 'Support hours / month' : 'Support hours (for the term)'} min={1} value={cust.hours} onChange={(v) => setCust({ ...cust, hours: v === '' ? '' : Number(v) })} />
                )}
                <Field label="No. of visits" value={cust.visits} onChange={(v) => setCust({ ...cust, visits: v === '' ? '' : Number(v) })} />
                {paidCoverage && (
                  <Field label="Contract amount" value={cust.monthlyCost} onChange={(v) => setCust({ ...cust, monthlyCost: v === '' ? '' : Number(v) })} />
                )}
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="text-base font-semibold text-foreground">Support hours settings</h2>
              {cust.hoursUnlimited ? (
                <p className="rounded-lg border bg-muted/20 p-3 text-sm text-muted-foreground">
                  Support hours are Unlimited — there is no allowance to count, cap or carry forward.
                </p>
              ) : (
                <SupportHoursConfig
                  value={{ hoursPeriod: cust.hoursPeriod, carryForward: cust.carryForward, allowTicketsAfterHours: cust.allowTicketsAfterHours, allowExcess: cust.allowExcess, excessApproval: cust.excessApproval, excessApproverId: cust.excessApproverId }}
                  onChange={(patch) => setCust((s) => ({ ...s, ...patch }))}
                  staff={staff}
                  live={contract?.support ?? null} />
              )}
            </section>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={cust.productIds.length === 0} onClick={saveCustomer}>Save contract</Button>
            <Button size="sm" variant="outline" disabled={!canRenew}
              title={canRenew ? undefined : 'Available within 30 days of expiry'}
              onClick={() => { setRenew({ months: 12, hoursUnlimited: cust.hoursUnlimited, hours: num(contract?.hours ?? null), visits: num(contract?.visits ?? null), monthlyCost: num(contract?.monthlyCost ?? null) }); setRenewOpen(true); }}>
              <RefreshCw className="size-4" /> Renew AMC
            </Button>
          </div>
          </>
          )}

          {/* The shared contract's own excess-hours requests. */}
          <ExcessHoursApprovals companyId={companyId!} ownerId={companyId} />
        </section>
      )}

      {/* Per-product management (only in per-product mode) */}
      {contractLoaded && scope === 'PRODUCT' && (
      <section className="mb-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-foreground">Products</h2>
          {isAdmin && <Button size="sm" onClick={() => navigate(`/admin/clients/${companyId}/assign`)}><Plus className="size-3.5" /> Assign a product</Button>}
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

        {/* Per-product requests all land here too, so an approver who opens the
            client rather than the product still finds what is waiting on them. */}
        <ExcessHoursApprovals companyId={companyId!} />
      </section>
      )}

      {/* The client's common team. One shared set whatever the contract scope —
          per-product overrides live on the product page. */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-1.5 text-base font-semibold text-foreground"><Users className="size-4" /> Default consultants</h2>
        <p className="text-sm text-muted-foreground">Route this client’s tickets to these agents for every product, unless that product has its own consultant assigned.</p>
        <ConsultantGrid modules={[]} consultants={contractConsultants} staff={clientProductAgents} onAdd={addContractConsultant} onRemove={removeConsultant} onPrimary={setPrimaryConsultant} emptyRowLabel="All products" readOnly={!isAdmin} />
      </section>


      {/* Either direction changes how this client's hours and visits are counted,
          so both are confirmed rather than done on a click — and confirming is
          what applies it, in both directions. */}
      <Dialog open={!!pendingScope} onOpenChange={(o) => { if (!o) setPendingScope(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pendingScope === 'PRODUCT' ? 'Switch to per-product contracts?' : 'Switch to one customer contract?'}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {pendingScope === 'PRODUCT' ? (
              <>
                {client?.name ?? 'This client'} is on one shared customer contract. Switching means every ticket hour and client
                visit draws down that product's own warranty/AMC pool instead of the shared one. The contract terms stay saved,
                so you can switch back.
              </>
            ) : (
              <>
                {client?.name ?? 'This client'} is on per-product contracts. One shared contract covers every ticked product with
                the same dates, support hours and visits, and all usage draws down that single pool. Each product's own terms stay
                saved, and any shared terms already on file are kept — fill in the ones that are missing below.
              </>
            )}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingScope(null)}>Cancel</Button>
            <Button onClick={confirmScope}>Switch</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Renew — extends the contract from its current end date by N months and
          resets the hours/visits pools for the new term. */}
      <Dialog open={renewOpen} onOpenChange={setRenewOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Renew contract</DialogTitle></DialogHeader>
          <SupportHoursChoice className="pt-1" unlimited={renew.hoursUnlimited} onChange={(u) => setRenew({ ...renew, hoursUnlimited: u })} />
          <div className="grid grid-cols-2 gap-3 py-2">
            <Field label="Extend by (months)" value={renew.months} min={1}
              onChange={(v) => setRenew({ ...renew, months: Number(v) })} />
            {!renew.hoursUnlimited && (
              <Field label="Support hours" min={1} value={renew.hours}
                onChange={(v) => setRenew({ ...renew, hours: v === '' ? '' : Number(v) })} />
            )}
            <Field label="Visits" value={renew.visits}
              onChange={(v) => setRenew({ ...renew, visits: v === '' ? '' : Number(v) })} />
            {paidCoverage && (
              <Field label="Monthly cost" value={renew.monthlyCost}
                onChange={(v) => setRenew({ ...renew, monthlyCost: v === '' ? '' : Number(v) })} />
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenewOpen(false)}>Cancel</Button>
            <Button onClick={doRenew} disabled={!renew.months || renew.months < 1 || (!renew.hoursUnlimited && (renew.hours === '' || Number(renew.hours) <= 0))}>Renew</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString() : '—');

/** Countdown for the contract's remaining term, in the per-product screen's "12 mo 4 d" shape. */
function timeLeft(daysLeft: number | null): string {
  if (daysLeft == null) return '';
  if (daysLeft <= 0) return 'Ended';
  const months = Math.floor(daysLeft / 30);
  const rem = daysLeft % 30;
  return `${months > 0 ? `${months} mo ${rem} d` : `${daysLeft} d`} left`;
}

function Field({ label, value, onChange, type = 'number', min }: { label: string; value: string | number; onChange: (v: string) => void; type?: string; min?: string | number }) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground">{label}</label>
      <Input type={type} min={min ?? (type === 'number' ? 0 : undefined)} value={value} onChange={(e) => onChange(e.target.value)} className="h-8" />
    </div>
  );
}
