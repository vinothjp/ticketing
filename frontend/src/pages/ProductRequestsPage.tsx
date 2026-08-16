import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { PackagePlus } from 'lucide-react';
import api from '../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

interface ProductRequest {
  id: string;
  status: 'PENDING' | 'GRANTED' | 'DECLINED';
  note?: string | null;
  decisionNote?: string | null;
  createdAt: string;
  product: { name: string; code: string };
  customerCompany: { name: string };
}

const today = () => new Date().toISOString().slice(0, 10);
const monthsFromNow = (m: number) => { const d = new Date(); d.setMonth(d.getMonth() + m); return d.toISOString().slice(0, 10); };
const emptyTerms = { coverageType: 'WARRANTY' as 'WARRANTY' | 'AMC', startDate: today(), endDate: monthsFromNow(12), supportHours: 100, visits: 4, contractAmount: 100000 };

const badge = (s: string) =>
  s === 'PENDING' ? { label: 'Pending', cls: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30' }
  : s === 'GRANTED' ? { label: 'Granted', cls: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30' }
  : { label: 'Declined', cls: 'bg-destructive/15 text-destructive border-destructive/30' };

export default function ProductRequestsPage() {
  const qc = useQueryClient();
  const [grantFor, setGrantFor] = useState<ProductRequest | null>(null);
  const [terms, setTerms] = useState(emptyTerms);
  const [declineFor, setDeclineFor] = useState<ProductRequest | null>(null);
  const [declineNote, setDeclineNote] = useState('');

  const { data: requests = [], isLoading } = useQuery<ProductRequest[]>({
    queryKey: ['product-requests'],
    queryFn: async () => (await api.get('/api/customer-companies/product-requests')).data,
  });
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['product-requests'] });
    qc.invalidateQueries({ queryKey: ['notifications'] });
  };

  const grant = useMutation({
    mutationFn: () => api.post(`/api/customer-companies/product-requests/${grantFor!.id}/grant`, {
      coverageType: terms.coverageType,
      startDate: terms.startDate, endDate: terms.endDate,
      supportHours: terms.supportHours, visits: terms.visits,
      ...(terms.coverageType === 'AMC' ? { contractAmount: terms.contractAmount } : {}),
    }),
    onSuccess: () => { invalidate(); setGrantFor(null); setTerms(emptyTerms); toast.success('Product granted to customer'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  });
  const decline = useMutation({
    mutationFn: () => api.post(`/api/customer-companies/product-requests/${declineFor!.id}/decline`, { note: declineNote.trim() || undefined }),
    onSuccess: () => { invalidate(); setDeclineFor(null); setDeclineNote(''); toast.success('Request declined'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  });

  const pending = requests.filter((r) => r.status === 'PENDING');
  const decided = requests.filter((r) => r.status !== 'PENDING');

  const row = (r: ProductRequest) => {
    const b = badge(r.status);
    return (
      <div key={r.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold text-foreground">{r.product.name}</span>
            <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${b.cls}`}>{b.label}</span>
          </div>
          <div className="text-sm text-muted-foreground">Requested by {r.customerCompany.name} · {new Date(r.createdAt).toLocaleDateString()}</div>
          {r.note && <p className="mt-1 text-sm text-foreground">“{r.note}”</p>}
          {r.decisionNote && <p className="mt-1 text-xs text-muted-foreground">Your note: {r.decisionNote}</p>}
        </div>
        {r.status === 'PENDING' && (
          <div className="flex shrink-0 gap-2">
            <Button size="sm" variant="outline" onClick={() => { setDeclineFor(r); setDeclineNote(''); }}>Decline</Button>
            <Button size="sm" onClick={() => { setGrantFor(r); setTerms(emptyTerms); }}>Grant</Button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-foreground">Product Requests</h1>
        <p className="text-sm text-muted-foreground">Customers asking to start using your products. Grant a request to set its warranty and AMC terms.</p>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : requests.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-12 text-center">
          <PackagePlus className="size-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No product requests yet.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {pending.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-muted-foreground">Pending ({pending.length})</h2>
              {pending.map(row)}
            </div>
          )}
          {decided.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-muted-foreground">Decided</h2>
              {decided.map(row)}
            </div>
          )}
        </div>
      )}

      {/* Grant dialog with terms */}
      <Dialog open={!!grantFor} onOpenChange={(o) => !o && setGrantFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Grant {grantFor?.product.name}</DialogTitle></DialogHeader>
          <RadioGroup value={terms.coverageType} onValueChange={(v) => setTerms({ ...terms, coverageType: v as 'WARRANTY' | 'AMC' })} className="flex gap-6">
            <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="WARRANTY" /> Under warranty <span className="text-xs text-muted-foreground">(free)</span></label>
            <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="AMC" /> Under AMC <span className="text-xs text-muted-foreground">(paid)</span></label>
          </RadioGroup>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start date" type="date" value={terms.startDate} onChange={(v) => setTerms({ ...terms, startDate: v as string })} />
            <Field label="End date" type="date" min={terms.startDate || undefined} value={terms.endDate} onChange={(v) => setTerms({ ...terms, endDate: v as string })} />
            <Field label="Support hours" value={terms.supportHours} onChange={(v) => setTerms({ ...terms, supportHours: v as number })} />
            <Field label="No. of visits" value={terms.visits} onChange={(v) => setTerms({ ...terms, visits: v as number })} />
            {terms.coverageType === 'AMC' && (
              <Field label="Contract amount" value={terms.contractAmount} onChange={(v) => setTerms({ ...terms, contractAmount: v as number })} />
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGrantFor(null)}>Cancel</Button>
            <Button disabled={grant.isPending} onClick={() => { if (terms.startDate && terms.endDate && terms.endDate <= terms.startDate) { toast.error('End date must be after the start date'); return; } grant.mutate(); }}>{grant.isPending ? 'Granting…' : 'Grant product'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Decline dialog */}
      <Dialog open={!!declineFor} onOpenChange={(o) => !o && setDeclineFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Decline request</DialogTitle></DialogHeader>
          <Textarea rows={3} value={declineNote} onChange={(e) => setDeclineNote(e.target.value)} placeholder="Reason (optional) — shown to the customer" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeclineFor(null)}>Cancel</Button>
            <Button variant="destructive" disabled={decline.isPending} onClick={() => decline.mutate()}>Decline</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, value, onChange, type = 'number', min }: { label: string; value: number | string; onChange: (v: number | string) => void; type?: 'number' | 'date'; min?: string | number }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">{label}</label>
      <Input type={type} min={min ?? (type === 'number' ? 0 : undefined)} value={value}
        onChange={(e) => onChange(type === 'number' ? Number(e.target.value) : e.target.value)} />
    </div>
  );
}
