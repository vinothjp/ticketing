import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, ShieldCheck, Wrench, Clock, MapPin, RefreshCw, Trash2, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import api from '../../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import ProductIcon from '@/components/ProductIcon';
import ConsultantGrid from '@/components/ConsultantGrid';

interface Pool { allocated: number | null; used: number; left: number | null }
interface Cov { end: string | null; label: string; pct: number; active: boolean }
interface Purchased {
  id: string; productId: string; productName: string; productCode: string; status: string; purchaseDate: string | null; agents: string[];
  warranty: Cov & { months: number }; amc: Cov & { start: string | null; type: 'FREE' | 'PAID'; freeMonths: number; daysLeft: number | null };
  hours: Pool; visits: Pool;
  paidTerms: { months: number | null; monthlyCost: number | null; hours: number | null; visits: number | null };
}
interface Consultant { id: string; userId: string; username: string | null; productId: string | null; moduleId: string | null; track: string | null; isPrimary?: boolean }
interface CatModule { id: string; name: string; tracks: string[] }
interface CatProduct { id: string; name: string; imageUrl?: string | null; modules: CatModule[] }
interface StaffUser { id: string; username: string }

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
  const [searchParams] = useSearchParams();

  const { data: company } = useQuery<{ name: string; contractScope?: 'PRODUCT' | 'CUSTOMER' }>({ queryKey: ['client', companyId], queryFn: async () => (await api.get(`/api/customer-companies/${companyId}`)).data });
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
          {!customerScoped && (
            <Button variant="outline" disabled={cp.amc.active && (cp.amc.daysLeft ?? 0) > 30}
              title={cp.amc.active && (cp.amc.daysLeft ?? 0) > 30 ? 'Available within 30 days of expiry' : undefined}
              onClick={() => { setRenew({ months: cp.paidTerms.months ?? 12, amcMonthlyCost: cp.paidTerms.monthlyCost ?? 0 }); setRenewOpen(true); }}>
              <RefreshCw className="size-4" /> Renew AMC
            </Button>
          )}
          <Button variant="outline" className="text-destructive hover:text-destructive" onClick={doRemove}><Trash2 className="size-4" /> Remove</Button>
        </div>
      </div>

      {!customerScoped && (
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
      )}

      {/* Consultants — full-width grid of Module × Technical / Functional / Others */}
      <section className={customerScoped ? 'space-y-3' : 'mt-8 space-y-3'}>
        <h2 className="flex items-center gap-1.5 text-base font-semibold text-foreground"><Users className="size-4" /> Consultants for this product</h2>
        <p className="text-sm text-muted-foreground">Route this client's tickets per module and track. Type a name to assign. Empty cells fall back to the module's default routing.</p>
        <ConsultantGrid modules={cat?.modules ?? []} consultants={productConsultants} staff={staff} onAdd={addConsultant} onRemove={removeConsultant} onPrimary={setPrimaryConsultant} />
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
