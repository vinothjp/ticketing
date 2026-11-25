import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Boxes, Plus, ShieldCheck, Wrench, Clock, CalendarClock, MapPin, Hourglass, ArrowRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isServicesOnly } from '@/lib/clientType';
import { useDateFormat } from '@/lib/dateFormat';
import { formatMoney } from '@/lib/currencies';
import { deploymentModelLabel } from '@/components/DeploymentModelChoice';
import api from '../lib/api';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

interface Coverage { end: string | null; daysLeft: number | null; label: string; pct: number; active: boolean }
interface AmcCoverage extends Coverage { type: 'FREE' | 'PAID'; freeMonths: number }
// `used` is the whole draw-down; the two `from*` halves say where it came from —
// time consultants logged on tickets vs. usage logged straight against the pool.
interface Pool { allocated: number | null; used: number; left: number | null; unlimited?: boolean; fromTickets?: number; fromLogged?: number }
interface PaidTerms { months: number | null; monthlyCost: number | null; hours: number | null; visits: number | null }
interface MyProduct {
  id: string; productName: string; productCode: string; status: 'ACTIVE' | 'EXPIRED' | 'TERMINATED';
  purchaseDate: string | null; agents: string[];
  warranty: Coverage & { months: number }; amc: AmcCoverage;
  hours: Pool; visits: Pool; paidTerms: PaidTerms;
  // False once the provider has switched off every module of it for you.
  activeForClient: boolean;
  // How you run it (S/4HANA only) — set by the provider; null when not chosen.
  deploymentModel?: string | null;
}
interface CatalogueItem { id: string; name: string; code: string; description?: string | null }
interface ProductReq { id: string; product: { name: string; code: string }; status: string; note?: string | null; decisionNote?: string | null; createdAt: string }

/** Hours to two decimals at most, without trailing zeros. */
const n2 = (n: number) => String(Math.round(n * 100) / 100);
const pctOf = (used: number, of: number | null) => (of ? Math.min(100, Math.round((used / of) * 100)) : 0);

const PILL = {
  ok: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  bad: 'border-destructive/30 bg-destructive/10 text-destructive',
  off: 'border-border bg-muted text-muted-foreground',
};

const statusPill = (s: string) =>
  s === 'ACTIVE' ? { label: 'Active', cls: PILL.ok }
  : s === 'EXPIRED' ? { label: 'Expired', cls: PILL.bad }
  : { label: 'Terminated', cls: PILL.off };

type Tone = 'default' | 'warn' | 'bad' | 'muted';
const TONE_TEXT: Record<Tone, string> = {
  default: 'text-foreground',
  warn: 'text-amber-600 dark:text-amber-400',
  bad: 'text-destructive',
  muted: 'text-muted-foreground',
};
const TONE_BAR: Record<Tone, string> = {
  default: 'bg-primary',
  warn: 'bg-amber-500',
  bad: 'bg-destructive',
  muted: 'bg-muted-foreground/30',
};

/**
 * One figure in a card's metric strip: icon + label, the value large, a muted
 * line under it, and an optional bar of how much is consumed.
 */
function Metric({ icon: Icon, label, value, sub, pct, tone = 'default', title }: {
  icon: LucideIcon; label: string; value: string; sub: string; pct?: number; tone?: Tone; title?: string;
}) {
  return (
    <div className="min-w-0 px-5 py-4" title={title}>
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className="size-3.5 shrink-0" /> {label}
      </div>
      <div className={cn('mt-1.5 truncate text-xl font-semibold tabular-nums', TONE_TEXT[tone])}>{value}</div>
      <div className="truncate text-xs text-muted-foreground" title={sub}>{sub}</div>
      {pct != null && (
        <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className={cn('h-full rounded-full transition-all', TONE_BAR[tone])} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
        </div>
      )}
    </div>
  );
}

/** Grade a consumed share: amber from 85 %, red once nothing is left. */
const usageTone = (pct: number, exhausted: boolean): Tone => (exhausted ? 'bad' : pct >= 85 ? 'warn' : 'default');

/**
 * A pool the client draws down (support hours, site visits): the amount **left**
 * large, "left of <allowance>" small beneath it, then the bar.
 * An unlimited pool still reports what was used; one with no allowance at all
 * says so instead of showing zeros.
 */
function Usage({ icon: Icon, label, pool, unit = '', per = '', noneLabel, title }: {
  icon: LucideIcon; label: string; pool: Pool | undefined; unit?: string; per?: string; noneLabel: string; title?: string;
}) {
  const fig = (n: number) => `${n2(n)}${unit}`;
  const capped = pool?.allocated != null;
  const pct = capped ? pctOf(pool!.used, pool!.allocated) : 0;
  const tone: Tone = capped ? usageTone(pct, (pool!.left ?? 0) <= 0) : 'default';
  const head = (
    <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
      <Icon className="size-3.5 shrink-0" /> {label}
    </div>
  );

  // No allowance and nothing unlimited about it: not part of the cover.
  if (!pool || (!capped && !pool.unlimited && !pool.used)) {
    return (
      <div className="min-w-0 px-5 py-4" title={title}>
        {head}
        <div className="mt-1.5 text-xl font-semibold text-muted-foreground">—</div>
        <div className="text-xs text-muted-foreground">{noneLabel}</div>
      </div>
    );
  }

  // Same shape as the coverage tile (client request): with an allowance, what is
  // left large and "left of <allowance>" small under it; unlimited (or no
  // allowance) has nothing to count down, so it shows what was used and
  // "Unlimited" / the none label.
  return (
    <Metric icon={Icon} label={label} title={title}
      value={capped ? fig(pool.left ?? 0) : `${fig(pool.used)} used`}
      sub={capped ? `left of ${fig(pool.allocated!)}${per ? ` ${per}` : ''}` : pool.unlimited ? 'Unlimited' : noneLabel}
      pct={capped ? pct : undefined}
      tone={tone} />
  );
}

/** "17.25 h on tickets · 2 h logged directly" — the halves that actually hold time. */
function spentBreakdown(p: Pool): string {
  const parts: string[] = [];
  if (p.fromTickets) parts.push(`${n2(p.fromTickets)} h on tickets`);
  if (p.fromLogged) parts.push(`${n2(p.fromLogged)} h logged directly`);
  return parts.join(' · ');
}

export default function MyProductsPage() {
  const qc = useQueryClient();
  // Dates and money follow the tenant (Organization screen), never the browser.
  const { fmtDate, currency } = useDateFormat();
  const [requestOpen, setRequestOpen] = useState(false);
  const [pick, setPick] = useState('');
  const [note, setNote] = useState('');

  const { data: contract } = useQuery<{
    clientType?: string;
    scope: 'PRODUCT' | 'CUSTOMER'; start: string | null; end: string | null; hours: number | null; visits: number | null;
    period?: { pct: number; daysLeft: number | null; active: boolean };
    hoursPool?: Pool;
    visitsPool?: Pool;
  }>({
    queryKey: ['my-product-contract'],
    queryFn: async () => (await api.get('/api/my-company/product-contract')).data,
  });
  const { data: products = [], isLoading } = useQuery<MyProduct[]>({
    queryKey: ['my-products'],
    queryFn: async () => (await api.get('/api/my-company/purchased-products')).data,
  });
  // An Implementation client bought services only — no warranty, AMC, hours or
  // visits to count down — so each product card shows just the product.
  const impl = isServicesOnly(contract?.clientType);
  const customerScope = !impl && contract?.scope === 'CUSTOMER';
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

  // ── The shared contract (customer scope): one summary card ──
  const contractCard = () => {
    const active = contract?.period?.active ?? true;
    const pct = contract?.period?.pct ?? 0;
    const daysLeft = contract?.period?.daysLeft ?? null;
    const hp = contract?.hoursPool;
    const vp = contract?.visitsPool;
    return (
      <section className="mb-6 overflow-hidden rounded-xl border bg-card shadow-xs">
        <header className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <CalendarClock className="size-5" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-semibold text-foreground">Service contract</h2>
                <span className={cn('rounded-full border px-2 py-0.5 text-xs font-medium', active ? PILL.ok : PILL.bad)}>
                  {active ? 'Active' : 'Expired'}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">One contract covering all your products</p>
            </div>
          </div>
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            {fmtDate(contract?.start ?? null)} <ArrowRight className="size-3.5" /> {fmtDate(contract?.end ?? null)}
          </span>
        </header>
        <div className="grid divide-y border-t bg-muted/20 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <Metric icon={Hourglass} label="Contract period"
            value={!active ? 'Ended' : daysLeft != null ? `${daysLeft} days` : '—'}
            sub={!active ? 'This contract has ended' : contract?.end ? `left, until ${fmtDate(contract.end)}` : 'No end date'}
            pct={pct} tone={!active ? 'bad' : pct >= 90 ? 'warn' : 'default'} />
          <Usage icon={Clock} label="Support hours" pool={hp} unit=" h" noneLabel="No allowance set"
            title={hp ? spentBreakdown(hp) || undefined : undefined} />
          <Usage icon={MapPin} label="Site visits" pool={vp} per="this month" noneLabel="Not included" />
        </div>
        <div className="border-t px-5 py-4">
          <div className="mb-2 text-xs font-medium text-muted-foreground">Products covered ({products.length})</div>
          <div className="flex flex-wrap gap-2">
            {products.map((p) => (
              <span key={p.id} className="inline-flex items-center gap-1.5 rounded-lg border bg-background px-2.5 py-1.5 text-sm text-foreground">
                <Boxes className="size-3.5 text-primary" /> {p.productName}
                {deploymentModelLabel(p.deploymentModel) && (
                  <span className="text-xs text-muted-foreground">· {deploymentModelLabel(p.deploymentModel)}</span>
                )}
              </span>
            ))}
          </div>
        </div>
      </section>
    );
  };

  // ── One purchased product (per-product scope, or services-only) ──
  const productCard = (p: MyProduct) => {
    // An active product the provider switched every module off for reads as
    // inactive — one pill, not two.
    const b = p.status === 'ACTIVE' && p.activeForClient === false
      ? { label: 'Inactive', cls: PILL.off }
      : statusPill(p.status);
    const isFree = p.amc.type === 'FREE';
    const amcWarn = p.amc.active && p.amc.pct >= 90;
    const showPaidCta = !impl && (p.status !== 'ACTIVE' || (isFree && amcWarn));
    const deployment = deploymentModelLabel(p.deploymentModel);
    // No purchase date → say nothing, rather than "Purchased —".
    const purchased = p.purchaseDate ? fmtDate(p.purchaseDate) : null;

    return (
      <article key={p.id} className="flex flex-col overflow-hidden rounded-xl border bg-card shadow-xs">
        <header className="flex items-start gap-3 px-5 py-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Boxes className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate font-semibold text-foreground" title={p.productName}>{p.productName}</h2>
              <span className={cn('rounded-full border px-2 py-0.5 text-xs font-medium', b.cls)}>{b.label}</span>
              {deployment && (
                <span className="rounded-full border bg-muted/50 px-2 py-0.5 text-xs text-muted-foreground">{deployment}</span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {[p.productCode, purchased ? `Purchased ${purchased}` : null].filter(Boolean).join(' · ') || ' '}
            </p>
          </div>
        </header>

        {!impl && (
          <div className="grid divide-y border-t bg-muted/20 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {/* One coverage timeline: Warranty (free) → AMC (paid). */}
            <Metric icon={isFree ? ShieldCheck : Wrench} label={isFree ? 'Warranty' : 'AMC'}
              // No end date means the provider hasn't entered the terms — not that
              // coverage ended, which is what "Ended" over "No end date" implied.
              value={!p.amc.end ? 'Not set' : p.amc.active ? p.amc.label : 'Ended'}
              sub={!p.amc.end ? 'No dates yet' : `${p.amc.active ? 'left, until' : 'ended'} ${fmtDate(p.amc.end)}`}
              pct={p.amc.end ? p.amc.pct : undefined}
              tone={!p.amc.end ? 'muted' : !p.amc.active ? 'bad' : amcWarn ? 'warn' : 'default'} />
            <Usage icon={Clock} label="Support hours" pool={p.hours} unit=" h" noneLabel="No allowance set"
              title={spentBreakdown(p.hours) || undefined} />
            <Usage icon={MapPin} label="Site visits" pool={p.visits} per="this month" noneLabel="Not included" />
          </div>
        )}

        {/* What the paid AMC costs once the warranty ends. */}
        {!impl && isFree && p.paidTerms.monthlyCost != null && (
          <div className="border-t px-5 py-3 text-xs text-muted-foreground">
            After warranty, AMC at <span className="font-medium text-foreground">{formatMoney(p.paidTerms.monthlyCost, currency)}/month</span>
            {p.paidTerms.hours != null && <> · {p.paidTerms.hours} h</>}
            {p.paidTerms.visits != null && <> · {p.paidTerms.visits} visits</>}
            {p.paidTerms.months != null && <> · {p.paidTerms.months} months</>}
          </div>
        )}

        {showPaidCta && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-amber-500/20 bg-amber-500/10 px-5 py-3">
            <span className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
              <Clock className="size-3.5" />
              {p.status === 'EXPIRED' ? 'Warranty ended — start a paid AMC to continue service.' : 'Warranty running out.'}
            </span>
            <Button size="sm" onClick={() => requestRenewal.mutate(p.id)} disabled={requestRenewal.isPending}>
              Request paid AMC
            </Button>
          </div>
        )}

      </article>
    );
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">My Products</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            The products you use from your provider, with their coverage and what is left of your support.
          </p>
        </div>
        <Button onClick={() => setRequestOpen(true)} disabled={catalogue.length === 0}>
          <Plus className="size-4" /> Request product
        </Button>
      </div>

      {pendingRequests.length > 0 && (
        <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm">
          <Clock className="mt-0.5 size-4 shrink-0 text-primary" />
          <span className="text-muted-foreground">
            <span className="font-medium text-foreground">Awaiting your provider: </span>
            {pendingRequests.map((r) => r.product.name).join(', ')}
          </span>
        </div>
      )}

      {customerScope && products.length > 0 && contractCard()}

      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : products.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-14 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Boxes className="size-6" />
          </span>
          <div>
            <p className="font-medium text-foreground">No products yet</p>
            <p className="text-sm text-muted-foreground">Request one and your provider will set it up.</p>
          </div>
        </div>
      ) : customerScope ? null : (
        <div className="grid gap-5 lg:grid-cols-2">
          {products.map(productCard)}
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
