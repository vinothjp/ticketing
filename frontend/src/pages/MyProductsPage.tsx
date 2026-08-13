import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Boxes, Plus, ShieldCheck, Wrench, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import api from '../lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

interface Coverage { end: string | null; daysLeft: number | null; pct: number; active: boolean }
interface AmcCoverage extends Coverage { type: 'FREE' | 'PAID'; monthlyCost: number | null; hoursPerMonth: number | null; visitsPerMonth: number | null; freeMonths: number }
interface MyProduct {
  id: string; productName: string; productCode: string; status: 'ACTIVE' | 'EXPIRED' | 'TERMINATED';
  purchaseDate: string | null; warranty: Coverage & { months: number }; amc: AmcCoverage;
}
interface CatalogueItem { id: string; name: string; code: string; description?: string | null }
interface ProductReq { id: string; product: { name: string; code: string }; status: string; note?: string | null; decisionNote?: string | null; createdAt: string }

const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString() : '—');
const inr = (n: number | null) => (n == null ? '—' : `₹${n.toLocaleString('en-IN')}`);

const statusBadge = (s: string) =>
  s === 'ACTIVE' ? { label: 'Active', cls: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30' }
  : s === 'EXPIRED' ? { label: 'Expired', cls: 'bg-destructive/15 text-destructive border-destructive/30' }
  : { label: 'Terminated', cls: 'bg-muted text-muted-foreground border-border' };

// A labelled coverage meter (warranty / AMC).
function Meter({ icon, title, subtitle, pct, active, daysLeft }: { icon: React.ReactNode; title: string; subtitle: string; pct: number; active: boolean; daysLeft: number | null }) {
  const warn = active && pct >= 90;
  const barColor = !active ? 'bg-destructive' : warn ? 'bg-amber-500' : 'bg-primary';
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="flex items-center gap-1.5 font-medium text-foreground">{icon} {title}</span>
        <span className={cn('text-xs', !active ? 'text-destructive' : warn ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground')}>
          {!active ? 'Ended' : daysLeft != null ? `${daysLeft} days left` : '—'}
        </span>
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

  const { data: products = [], isLoading } = useQuery<MyProduct[]>({
    queryKey: ['my-products'],
    queryFn: async () => (await api.get('/api/my-company/purchased-products')).data,
  });
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
          <p className="text-sm text-muted-foreground">Products you use from your provider, with warranty and AMC coverage.</p>
        </div>
        <Button onClick={() => setRequestOpen(true)} disabled={catalogue.length === 0}><Plus className="size-4" /> Request product</Button>
      </div>

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
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {products.map((p) => {
            const b = statusBadge(p.status);
            const amcWarn = p.amc.active && p.amc.pct >= 90;
            const needsRenewal = p.status !== 'ACTIVE' || amcWarn;
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
                  </div>

                  <Meter
                    icon={<ShieldCheck className="size-3.5" />}
                    title="Warranty"
                    subtitle={`${p.warranty.months} months · ends ${fmt(p.warranty.end)}`}
                    pct={p.warranty.pct} active={p.warranty.active} daysLeft={p.warranty.daysLeft}
                  />
                  <Meter
                    icon={<Wrench className="size-3.5" />}
                    title={`AMC — ${p.amc.type === 'FREE' ? 'Free period' : 'Paid'}`}
                    subtitle={p.amc.type === 'FREE'
                      ? `Free for ${p.amc.freeMonths} months · ends ${fmt(p.amc.end)} · then ${inr(p.amc.monthlyCost)}/mo`
                      : `${inr(p.amc.monthlyCost)}/mo · ${p.amc.hoursPerMonth ?? '—'} hrs · ${p.amc.visitsPerMonth ?? '—'} visits · ends ${fmt(p.amc.end)}`}
                    pct={p.amc.pct} active={p.amc.active} daysLeft={p.amc.daysLeft}
                  />

                  {needsRenewal && (
                    <div className="flex items-center justify-between gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                      <span className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                        <Clock className="size-3.5" />
                        {p.status === 'EXPIRED' ? 'Service paused — renew to raise tickets again.' : 'Coverage running out.'}
                      </span>
                      <Button size="sm" variant="outline" onClick={() => requestRenewal.mutate(p.id)} disabled={requestRenewal.isPending}>
                        Request renewal
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
