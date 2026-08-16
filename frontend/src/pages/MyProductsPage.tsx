import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Boxes, Plus, ShieldCheck, Wrench, Clock, CalendarClock, Users, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';
import api from '../lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

interface Coverage { end: string | null; daysLeft: number | null; label: string; pct: number; active: boolean }
interface AmcCoverage extends Coverage { type: 'FREE' | 'PAID'; freeMonths: number }
interface Pool { allocated: number | null; used: number; left: number | null }
interface PaidTerms { months: number | null; monthlyCost: number | null; hours: number | null; visits: number | null }
interface MyProduct {
  id: string; productName: string; productCode: string; status: 'ACTIVE' | 'EXPIRED' | 'TERMINATED';
  purchaseDate: string | null; agents: string[];
  warranty: Coverage & { months: number }; amc: AmcCoverage;
  hours: Pool; visits: Pool; paidTerms: PaidTerms;
}
interface CatalogueItem { id: string; name: string; code: string; description?: string | null }
interface ProductReq { id: string; product: { name: string; code: string }; status: string; note?: string | null; decisionNote?: string | null; createdAt: string }

const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString() : '—');
const inr = (n: number | null) => (n == null ? '—' : `₹${n.toLocaleString('en-IN')}`);

const statusBadge = (s: string) =>
  s === 'ACTIVE' ? { label: 'Active', cls: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30' }
  : s === 'EXPIRED' ? { label: 'Expired', cls: 'bg-destructive/15 text-destructive border-destructive/30' }
  : { label: 'Terminated', cls: 'bg-muted text-muted-foreground border-border' };

// A compact stat tile for the contract summary.
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
      <div className="text-xl font-bold text-foreground">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

// A big countdown tile (warranty / AMC time left).
function Countdown({ icon, label, value, active }: { icon: React.ReactNode; label: string; value: string; active: boolean }) {
  return (
    <div className={cn('rounded-lg border px-3 py-2.5', active ? 'bg-muted/30' : 'border-destructive/30 bg-destructive/5')}>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">{icon} {label}</div>
      <div className={cn('mt-0.5 text-lg font-bold', active ? 'text-foreground' : 'text-destructive')}>{active ? value : 'Ended'}</div>
    </div>
  );
}

// A labelled coverage/usage meter. `hideRight` drops the days-left chip (for pools).
function Meter({ icon, title, subtitle, pct, active, daysLeft, hideRight }: { icon: React.ReactNode; title: string; subtitle: string; pct: number; active: boolean; daysLeft: number | null; hideRight?: boolean }) {
  const warn = active && pct >= 85;
  const barColor = !active ? 'bg-destructive' : warn ? 'bg-amber-500' : 'bg-primary';
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="flex items-center gap-1.5 font-medium text-foreground">{icon} {title}</span>
        {!hideRight && (
          <span className={cn('text-xs', !active ? 'text-destructive' : warn ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground')}>
            {!active ? 'Ended' : daysLeft != null ? `${daysLeft} days left` : '—'}
          </span>
        )}
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full rounded-full', barColor)} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <div className="text-xs text-muted-foreground">{subtitle}</div>
    </div>
  );
}

export default function MyProductsPage() {
  const qc = useQueryClient();
  const [requestOpen, setRequestOpen] = useState(false);
  const [pick, setPick] = useState('');
  const [note, setNote] = useState('');

  const { data: contract } = useQuery<{
    scope: 'PRODUCT' | 'CUSTOMER'; start: string | null; end: string | null; hours: number | null; visits: number | null;
    period?: { pct: number; daysLeft: number | null; active: boolean };
    hoursPool?: { allocated: number | null; used: number; left: number | null };
    visitsPool?: { allocated: number | null; used: number; left: number | null };
  }>({
    queryKey: ['my-product-contract'],
    queryFn: async () => (await api.get('/api/my-company/product-contract')).data,
  });
  const { data: products = [], isLoading } = useQuery<MyProduct[]>({
    queryKey: ['my-products'],
    queryFn: async () => (await api.get('/api/my-company/purchased-products')).data,
  });
  const customerScope = contract?.scope === 'CUSTOMER';
  // Contract-period progress for the customer-specific view (from the shared pool).
  const cPct = contract?.period?.pct ?? 0;
  const cDaysLeft = contract?.period?.daysLeft ?? null;
  const cActive = contract?.period?.active ?? true;
  const hoursLeft = contract?.hoursPool?.left ?? null;
  const visitsLeft = contract?.visitsPool?.left ?? null;
  const { data: catalogue = [] } = useQuery<CatalogueItem[]>({
    queryKey: ['product-catalogue'],
    queryFn: async () => (await api.get('/api/my-company/product-catalogue')).data,
  });
  const { data: requests = [] } = useQuery<ProductReq[]>({
    queryKey: ['my-product-requests'],
    queryFn: async () => (await api.get('/api/my-company/product-requests')).data,
  });
  const pendingRequests = requests.filter((r) => r.status === 'PENDING');

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['my-products'] });
    qc.invalidateQueries({ queryKey: ['product-catalogue'] });
    qc.invalidateQueries({ queryKey: ['my-product-requests'] });
    qc.invalidateQueries({ queryKey: ['notifications'] });
  };

  const requestProduct = useMutation({
    mutationFn: () => api.post('/api/my-company/product-requests', { productId: pick, note: note.trim() || undefined }),
    onSuccess: () => { invalidate(); setRequestOpen(false); setPick(''); setNote(''); toast.success('Request sent to your provider'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error sending request'),
  });
  const requestRenewal = useMutation({
    mutationFn: (cpId: string) => api.post(`/api/my-company/purchased-products/${cpId}/request-renewal`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['notifications'] }); toast.success('Renewal request sent to your provider'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  });

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">My Products</h1>
          <p className="text-sm text-muted-foreground">
            Products you use from your provider, with warranty and AMC coverage. Your provider sets these up — use <span className="font-medium text-foreground">Request product</span> to ask for changes.
          </p>
        </div>
        <Button onClick={() => setRequestOpen(true)} disabled={catalogue.length === 0}><Plus className="size-4" /> Request product</Button>
      </div>

      {customerScope && (
        <Card className="mb-6">
          <CardContent className="space-y-5 py-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CalendarClock className="size-5 text-primary" />
                <span className="text-lg font-semibold text-foreground">Service contract</span>
                <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${cActive ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30' : 'bg-destructive/15 text-destructive border-destructive/30'}`}>
                  {cActive ? 'Active' : 'Expired'}
                </span>
              </div>
              <span className="text-sm text-muted-foreground">{fmt(contract?.start ?? null)} → {fmt(contract?.end ?? null)}</span>
            </div>

            {/* Contract period progress */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Contract period</span>
                <span className={cActive && cPct >= 90 ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}>
                  {cActive ? `${cDaysLeft} days left` : 'Ended'}
                </span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                <div className={`h-full rounded-full ${!cActive ? 'bg-destructive' : cPct >= 90 ? 'bg-amber-500' : 'bg-primary'}`} style={{ width: `${cPct}%` }} />
              </div>
            </div>

            {/* Stat tiles — live pool */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label={contract?.hours != null ? `Hours left of ${contract.hours}` : 'Support hours'} value={hoursLeft != null ? String(hoursLeft) : '—'} />
              <Stat label={contract?.visits != null ? `Visits left of ${contract.visits}` : 'Site visits'} value={visitsLeft != null ? String(visitsLeft) : '—'} />
              <Stat label="Days remaining" value={cDaysLeft != null ? String(cDaysLeft) : '—'} />
              <Stat label="Products covered" value={String(products.length)} />
            </div>

            {/* Covered products */}
            <div>
              <div className="mb-2 text-sm font-medium text-foreground">Covered products</div>
              <div className="grid gap-2 sm:grid-cols-2">
                {products.map((p) => (
                  <div key={p.id} className="flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm text-foreground">
                    <Boxes className="size-4 text-muted-foreground" /> {p.productName}
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {pendingRequests.length > 0 && (
        <div className="mb-5 rounded-lg border bg-muted/30 px-4 py-3 text-sm">
          <span className="font-medium text-foreground">Pending requests: </span>
          {pendingRequests.map((r) => r.product.name).join(', ')} — awaiting your provider.
        </div>
      )}

      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : products.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-12 text-center">
          <Boxes className="size-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">You have no products yet. Request one from your provider.</p>
        </div>
      ) : customerScope ? null : (
        <div className="grid gap-4 md:grid-cols-2">
          {products.map((p) => {
            const b = statusBadge(p.status);
            const amcWarn = p.amc.active && p.amc.pct >= 90;
            const isFree = p.amc.type === 'FREE';
            const showPaidCta = p.status !== 'ACTIVE' || (isFree && amcWarn);
            return (
              <Card key={p.id}>
                <CardContent className="space-y-4 py-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-base font-semibold text-foreground">{p.productName}</span>
                        <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${b.cls}`}>{b.label}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">Purchased {fmt(p.purchaseDate)}</div>
                    </div>
                    {p.agents.length > 0 && (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Users className="size-3.5" /> {p.agents.join(', ')}
                      </div>
                    )}
                  </div>

                  {/* One coverage timeline: Warranty (free) → AMC (paid) */}
                  <div className="grid grid-cols-1 gap-3">
                    <Countdown icon={isFree ? <ShieldCheck className="size-4" /> : <Wrench className="size-4" />} label={`${isFree ? 'Warranty' : 'AMC'} left`} value={p.amc.label} active={p.amc.active} />
                  </div>

                  {/* Live support-hours + visits pools */}
                  <Meter icon={<Clock className="size-3.5" />} title="Support hours"
                    subtitle={p.hours.allocated == null ? 'Not included' : `${p.hours.left} of ${p.hours.allocated} hours left`}
                    pct={p.hours.allocated ? Math.round((p.hours.used / p.hours.allocated) * 100) : 0}
                    active={(p.hours.left ?? 0) > 0} daysLeft={null} hideRight />
                  <Meter icon={<MapPin className="size-3.5" />} title="Site visits"
                    subtitle={p.visits.allocated == null ? 'Not included' : `${p.visits.left} of ${p.visits.allocated} visits left`}
                    pct={p.visits.allocated ? Math.round((p.visits.used / p.visits.allocated) * 100) : 0}
                    active={(p.visits.left ?? 0) > 0} daysLeft={null} hideRight />

                  {/* What the paid AMC costs once the warranty ends */}
                  {isFree && p.paidTerms.monthlyCost != null && (
                    <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                      After warranty — AMC: <span className="font-medium text-foreground">{inr(p.paidTerms.monthlyCost)}/mo</span>
                      {p.paidTerms.hours != null && <> · {p.paidTerms.hours} hrs</>}
                      {p.paidTerms.visits != null && <> · {p.paidTerms.visits} visits</>}
                      {p.paidTerms.months != null && <> · {p.paidTerms.months} months</>}
                    </div>
                  )}

                  {showPaidCta && (
                    <div className="flex items-center justify-between gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                      <span className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                        <Clock className="size-3.5" />
                        {p.status === 'EXPIRED' ? 'Warranty ended — start a paid AMC to continue service.' : 'Warranty running out.'}
                      </span>
                      <Button size="sm" onClick={() => requestRenewal.mutate(p.id)} disabled={requestRenewal.isPending}>
                        Request paid AMC
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={requestOpen} onOpenChange={setRequestOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Request a product</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Product</label>
              <Select value={pick} onValueChange={setPick}>
                <SelectTrigger><SelectValue placeholder="Choose a product to request" /></SelectTrigger>
                <SelectContent>
                  {catalogue.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Note <span className="font-normal text-muted-foreground">(optional)</span></label>
              <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why you need this product" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRequestOpen(false)}>Cancel</Button>
            <Button disabled={!pick || requestProduct.isPending} onClick={() => requestProduct.mutate()}>
              {requestProduct.isPending ? 'Sending…' : 'Send request'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
