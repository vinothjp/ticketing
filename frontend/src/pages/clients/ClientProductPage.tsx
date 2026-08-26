import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, ShieldCheck, Wrench, Clock, MapPin, RefreshCw, Trash2, Users } from 'lucide-react';
import api from '../../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import ProductIcon from '@/components/ProductIcon';
import ConsultantGrid from '@/components/ConsultantGrid';
import SupportHoursChoice from '@/components/SupportHoursChoice';
import SupportHoursConfig from '@/components/SupportHoursConfig';
import CoverageMeter from '@/components/CoverageMeter';
import { useExcessRequests, useDecideExcess, latestExcessFor } from '@/components/excessHoursQueries';
import { useAuth } from '../../context/AuthContext';

interface Pool { allocated: number | null; used: number; left: number | null; unlimited?: boolean }
interface Cov { end: string | null; label: string; pct: number; active: boolean }
interface Support {
  period: 'FULL_AMC' | 'MONTHLY'; carryForward: boolean; allowTicketsAfterHours: boolean; allowExcess: boolean; excessApproval: boolean;
  approverId: string | null; approverName: string | null;
  currentAllocated: number | null; carriedIn: number; currentUsed: number; available: number | null;
}
interface Purchased {
  id: string; productId: string; productName: string; productCode: string; status: string; purchaseDate: string | null; agents: string[];
  warranty: Cov & { months: number }; amc: Cov & { start: string | null; type: 'FREE' | 'PAID'; freeMonths: number; daysLeft: number | null };
  hours: Pool; visits: Pool;
  paidTerms: { months: number | null; monthlyCost: number | null; hoursUnlimited?: boolean; hours: number | null; visits: number | null };
  support?: Support;
}
interface Consultant { id: string; userId: string; username: string | null; productId: string | null; moduleId: string | null; track: string | null; isPrimary?: boolean }
interface CatAgent { user: { id: string; username: string } }
interface CatModule { id: string; name: string; tracks: string[]; consultants: CatAgent[] }
interface CatProduct { id: string; name: string; imageUrl?: string | null; modules: CatModule[]; consultants: CatAgent[] }
interface StaffUser { id: string; username: string }

const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString() : '—');
const statusCls = (s: string) =>
  s === 'ACTIVE' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
  : s === 'EXPIRED' ? 'bg-destructive/15 text-destructive border-destructive/30'
  : 'bg-muted text-muted-foreground border-border';

function Num({ label, value, onChange, type = 'number', min, disabled }: { label: string; value: string | number; onChange: (v: string) => void; type?: string; min?: string | number; disabled?: boolean }) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground">{label}</label>
      <Input type={type} min={min ?? (type === 'number' ? 0 : undefined)} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="h-8" />
    </div>
  );
}

export default function ClientProductPage() {
  const { companyId, cpId } = useParams<{ companyId: string; cpId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();

  const { data: company } = useQuery<{ name: string; contractScope?: 'PRODUCT' | 'CUSTOMER' }>({ queryKey: ['client', companyId], queryFn: async () => (await api.get(`/api/customer-companies/${companyId}`)).data });
  const { data: products = [] } = useQuery<Purchased[]>({ queryKey: ['client-products', companyId], queryFn: async () => (await api.get(`/api/customer-companies/${companyId}/purchased-products`)).data });
  const { data: consultants = [] } = useQuery<Consultant[]>({ queryKey: ['client-consultants', companyId], queryFn: async () => (await api.get(`/api/customer-companies/${companyId}/consultants`)).data });
  const { data: catalog = [] } = useQuery<CatProduct[]>({ queryKey: ['products'], queryFn: async () => (await api.get('/api/products')).data });
  const { data: staff = [] } = useQuery<StaffUser[]>({ queryKey: ['users'], queryFn: async () => (await api.get('/api/users')).data });

  const cp = products.find((p) => p.id === cpId);
  const cat = catalog.find((c) => c.id === cp?.productId);
  const productConsultants = consultants.filter((c) => c.productId === cp?.productId);
  // The agent dropdown only offers agents assigned to this product in the Products screen.
  const productAgents = (() => {
    const byId = new Map<string, StaffUser>();
    for (const m of cat?.modules ?? []) for (const a of m.consultants ?? []) byId.set(a.user.id, a.user);
    for (const a of cat?.consultants ?? []) byId.set(a.user.id, a.user);
    return [...byId.values()];
  })();

  // Warranty is free support, so a new/unsaved coverage starts Unlimited.
  const [terms, setTerms] = useState({ coverageType: 'WARRANTY' as 'WARRANTY' | 'AMC', startDate: '', endDate: '', supportHoursUnlimited: true, supportHours: 0, visits: 0, contractAmount: 0,
    hoursPeriod: 'FULL_AMC' as 'FULL_AMC' | 'MONTHLY', carryForward: false, allowTicketsAfterHours: true, allowExcess: false, excessApproval: false, excessApproverId: '' });
  // Hydrate from the saved coverage once the products query lands. Guarded on a
  // real row, so an in-flight refetch never blanks an already-hydrated form.
  useEffect(() => {
    if (cp) setTerms({
      coverageType: cp.amc.type === 'FREE' ? 'WARRANTY' : 'AMC',
      startDate: cp.amc.start ? cp.amc.start.slice(0, 10) : '',
      endDate: cp.amc.end ? cp.amc.end.slice(0, 10) : '',
      supportHoursUnlimited: cp.hours.unlimited ?? cp.hours.allocated == null,
      supportHours: cp.hours.allocated ?? 0,
      visits: cp.visits.allocated ?? 0,
      contractAmount: cp.paidTerms.monthlyCost ?? 0,
      hoursPeriod: cp.support?.period ?? 'FULL_AMC',
      carryForward: cp.support?.carryForward ?? false,
      allowTicketsAfterHours: cp.support?.allowTicketsAfterHours ?? true,
      allowExcess: cp.support?.allowExcess ?? false,
      excessApproval: cp.support?.excessApproval ?? false,
      excessApproverId: cp.support?.approverId ?? '',
    });
  }, [cp]);
  // Switching to warranty preselects Unlimited (free support); AMC keeps the
  // current choice.
  const onCoverage = (v: string) => {
    if (!v) return;
    const coverageType = v as 'WARRANTY' | 'AMC';
    setTerms((t) => ({ ...t, coverageType, supportHoursUnlimited: coverageType === 'WARRANTY' ? true : t.supportHoursUnlimited }));
  };

  const invalidate = () => { qc.invalidateQueries({ queryKey: ['client-products', companyId] }); qc.invalidateQueries({ queryKey: ['client-consultants', companyId] }); };
  const run = async (p: Promise<unknown>, ok?: string) => { try { await p; invalidate(); if (ok) toast.success(ok); } catch (e: any) { toast.error(e.response?.data?.message || 'Error'); } };

  const saveTerms = () => {
    if (terms.startDate && terms.endDate && terms.endDate <= terms.startDate) { toast.error('End date must be after the start date'); return; }
    if (!terms.supportHoursUnlimited && Number(terms.supportHours) <= 0) { toast.error('Enter support hours greater than 0, or choose Unlimited'); return; }
    run(api.patch(`/api/customer-companies/purchased-products/${cpId}`, {
      coverageType: terms.coverageType,
      startDate: terms.startDate || undefined,
      endDate: terms.endDate || undefined,
      // Unlimited carries no allocation at all.
      supportHoursUnlimited: terms.supportHoursUnlimited,
      ...(terms.supportHoursUnlimited ? {} : { supportHours: Number(terms.supportHours) }),
      visits: Number(terms.visits),
      ...(terms.coverageType === 'AMC' ? { contractAmount: Number(terms.contractAmount) } : {}),
      // Support-hours config; approver cleared → explicit null so the API disconnects it.
      hoursPeriod: terms.hoursPeriod,
      carryForward: terms.hoursPeriod === 'MONTHLY' && terms.carryForward,
      allowTicketsAfterHours: terms.allowTicketsAfterHours,
      allowExcess: terms.allowExcess,
      excessApproval: terms.allowExcess && terms.excessApproval,
      excessApproverId: terms.allowExcess && terms.excessApproval && terms.excessApproverId ? terms.excessApproverId : null,
    }), 'Terms saved');
  };

  // Consultants reach this screen read-only — they are here to decide an
  // excess-hours request, not to change the contract. Every write behind these
  // controls is Admin-only on the API; hiding them keeps the page honest rather
  // than offering buttons that 403.
  const { user } = useAuth();
  const isAdmin = !!user?.roles.includes('Admin');
  // The live excess-hours request for this product's pool, decided inline in the
  // support-hours card below. Readable by any staff member (the GET is Admin+Viewer);
  // who may *decide* mirrors the backend rule — the named approver, or an Admin.
  const { data: excessRequests = [] } = useExcessRequests(companyId);
  const excessRequest = latestExcessFor(excessRequests, cpId);
  const decideExcess = useDecideExcess(companyId);
  const canDecideExcess = excessRequest?.status === 'PENDING' && (isAdmin || excessRequest.approverUserId === user?.id);
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
  const setPrimaryConsultant = (id: string) => run(api.put(`/api/customer-companies/consultants/${id}/primary`, {}));
  const addConsultant = (moduleId: string | null, col: string, userId: string) =>
    run(api.post(`/api/customer-companies/${companyId}/consultants`, {
      userId, productId: cp!.productId, moduleId: moduleId || undefined,
      track: col === 'OTHERS' ? undefined : col,
    }), 'Consultant assigned');

  if (!cp) return <p className="text-muted-foreground">Loading…</p>;
  // On a shared customer contract, per-product coverage/terms don't apply — the
  // product page is only for its consultants. Driven by the saved scope, or by
  // navigating here from the customer-contract view (?view=consultants).
  const customerScoped = company?.contractScope === 'CUSTOMER' || searchParams.get('view') === 'consultants';
  // Support-hours meter figures: MONTHLY reads this month's ledger, else the whole-term pool.
  const monthlyHrs = cp.support?.period === 'MONTHLY' && !cp.hours.unlimited;
  const hAlloc = monthlyHrs ? (cp.support!.currentAllocated ?? 0) + cp.support!.carriedIn : cp.hours.allocated;
  const hUsed = monthlyHrs ? cp.support!.currentUsed : cp.hours.used;
  const hLeft = monthlyHrs ? cp.support!.available : cp.hours.left;
  const hUnlimited = monthlyHrs ? false : !!cp.hours.unlimited;

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
          {!customerScoped && isAdmin && (
            <Button variant="outline" disabled={cp.amc.active && (cp.amc.daysLeft ?? 0) > 30}
              title={cp.amc.active && (cp.amc.daysLeft ?? 0) > 30 ? 'Available within 30 days of expiry' : undefined}
              onClick={() => { setRenew({ months: cp.paidTerms.months ?? 12, amcMonthlyCost: cp.paidTerms.monthlyCost ?? 0 }); setRenewOpen(true); }}>
              <RefreshCw className="size-4" /> Renew AMC
            </Button>
          )}
          {isAdmin && (
            <Button variant="outline" className="text-destructive hover:text-destructive" onClick={doRemove}><Trash2 className="size-4" /> Remove</Button>
          )}
        </div>
      </div>

      {!customerScoped && (
      <div className="space-y-6">
        {/* Coverage — one timeline: Warranty (free) → AMC (paid). The three meters
            run across the top so the terms and their settings can sit side by
            side beneath them. */}
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-foreground">Coverage</h2>
          <div className="grid gap-3 md:grid-cols-3">
            <CoverageMeter
              icon={cp.amc.type === 'FREE' ? <ShieldCheck className="size-4" /> : <Wrench className="size-4" />}
              title={cp.amc.type === 'FREE' ? 'Warranty (free)' : 'AMC (paid)'}
              subtitle={`ends ${fmt(cp.amc.end)}`} pct={cp.amc.pct} active={cp.amc.active}
              right={cp.amc.active ? cp.amc.label + ' left' : 'Ended'} />
            <CoverageMeter icon={<Clock className="size-4" />} title={monthlyHrs ? 'Support hours (this month)' : 'Support hours'}
              subtitle={hUnlimited ? `Unlimited — ${hUsed} spent` : hAlloc == null ? 'Not included' : `${hLeft} of ${hAlloc} left${monthlyHrs ? ' this month' : ''}`}
              pct={hAlloc ? Math.round((hUsed / hAlloc) * 100) : 0}
              active={hUnlimited || (hLeft ?? 0) > 0} right={hUnlimited ? 'Unlimited' : ''} />
            <CoverageMeter icon={<MapPin className="size-4" />} title="Site visits" subtitle={cp.visits.allocated == null ? 'Not included' : `${cp.visits.left} of ${cp.visits.allocated} left`} pct={cp.visits.allocated ? Math.round((cp.visits.used / cp.visits.allocated) * 100) : 0} active={(cp.visits.left ?? 0) > 0} right="" />
          </div>
        </section>

        {/* What was agreed (left) and how the hours are governed (right), as two
            cards of equal height — `items-stretch` + `h-full`, with Save terms
            pinned to the left card's floor by `mt-auto` so both columns end on
            the same line instead of leaving a band under the shorter one.
            Every staff member reads this; only an Admin writes it. */}
        <div className="grid items-stretch gap-4 lg:grid-cols-2">
          <section className="flex h-full flex-col gap-3 rounded-lg border bg-card p-4">
            <h2 className="text-base font-semibold text-foreground">Terms</h2>
            <RadioGroup value={terms.coverageType} onValueChange={onCoverage} disabled={!isAdmin} className="flex gap-5">
              <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="WARRANTY" /> Under warranty <span className="text-xs text-muted-foreground">(free)</span></label>
              <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="AMC" /> Under AMC <span className="text-xs text-muted-foreground">(paid)</span></label>
            </RadioGroup>
            <SupportHoursChoice unlimited={terms.supportHoursUnlimited} disabled={!isAdmin} onChange={(u) => setTerms({ ...terms, supportHoursUnlimited: u })} />
            <div className="grid grid-cols-2 gap-2">
              <Num label="Start date" type="date" disabled={!isAdmin} value={terms.startDate} onChange={(v) => setTerms({ ...terms, startDate: v })} />
              <Num label="End date" type="date" min={terms.startDate || undefined} disabled={!isAdmin} value={terms.endDate} onChange={(v) => setTerms({ ...terms, endDate: v })} />
              {!terms.supportHoursUnlimited && (
                <Num label={terms.hoursPeriod === 'MONTHLY' ? 'Support hours / month' : 'Support hours (for the term)'} min={1} disabled={!isAdmin} value={terms.supportHours} onChange={(v) => setTerms({ ...terms, supportHours: Number(v) })} />
              )}
              <Num label="No. of visits" disabled={!isAdmin} value={terms.visits} onChange={(v) => setTerms({ ...terms, visits: Number(v) })} />
              {/* What the client pays is withheld from non-Admins server-side — it
                  arrives null, so don't render an empty box for it. */}
              {isAdmin && terms.coverageType === 'AMC' && (
                <Num label="Contract amount" value={terms.contractAmount} onChange={(v) => setTerms({ ...terms, contractAmount: Number(v) })} />
              )}
            </div>
            {isAdmin && (
              <div className="mt-auto flex justify-end pt-2">
                <Button size="sm" onClick={saveTerms}>Save terms</Button>
              </div>
            )}
          </section>

          <section className="flex h-full flex-col gap-3 rounded-lg border bg-card p-4">
            <h2 className="text-base font-semibold text-foreground">Support hours settings</h2>
            {terms.supportHoursUnlimited ? (
              <p className="rounded-lg border bg-muted/20 p-3 text-sm text-muted-foreground">
                Support hours are Unlimited — there is no allowance to count, cap or carry forward.
              </p>
            ) : (
              <SupportHoursConfig
                value={{ hoursPeriod: terms.hoursPeriod, carryForward: terms.carryForward, allowTicketsAfterHours: terms.allowTicketsAfterHours, allowExcess: terms.allowExcess, excessApproval: terms.excessApproval, excessApproverId: terms.excessApproverId }}
                onChange={(patch) => setTerms((t) => ({ ...t, ...patch }))}
                staff={staff}
                live={cp.support ?? null}
                readOnly={!isAdmin}
                approverName={cp.support?.approverName}
                request={excessRequest}
                canDecide={canDecideExcess}
                deciding={decideExcess.isPending}
                onDecide={(approve) => excessRequest && decideExcess.mutate({ id: excessRequest.id, approve })} />
            )}
          </section>
        </div>
      </div>
      )}

      {/* Consultants — full-width grid of Module × Technical / Functional / Others */}
      <section className={customerScoped ? 'space-y-3' : 'mt-8 space-y-3'}>
        <h2 className="flex items-center gap-1.5 text-base font-semibold text-foreground"><Users className="size-4" /> Consultants for this product</h2>
        <p className="text-sm text-muted-foreground">Route this client's tickets per module and track. Type a name to assign. Empty cells fall back to the module's default routing.</p>
        <ConsultantGrid modules={cat?.modules ?? []} consultants={productConsultants} staff={productAgents} onAdd={addConsultant} onRemove={removeConsultant} onPrimary={setPrimaryConsultant} readOnly={!isAdmin} />
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
