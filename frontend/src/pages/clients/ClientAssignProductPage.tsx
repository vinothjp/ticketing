import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Plus, Users } from 'lucide-react';
import api from '../../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import ConsultantGrid from '@/components/ConsultantGrid';

interface CatAgent { track: string; isPrimary?: boolean; user: { id: string; username: string } }
interface CatModule { id: string; name: string; consultants: CatAgent[] }
interface CatProduct { id: string; name: string; imageUrl?: string | null; modules: CatModule[]; consultants: CatAgent[] }
interface Purchased { productId: string }
interface Client { id: string; name: string }
interface StaffUser { id: string; username: string }

const today = () => new Date().toISOString().slice(0, 10);
const monthsFromNow = (m: number) => { const d = new Date(); d.setMonth(d.getMonth() + m); return d.toISOString().slice(0, 10); };

type Draft = { id: string; userId: string; username: string | null; moduleId: string | null; track: string | null; isPrimary: boolean };
const cellKey = (moduleId: string | null, track: string | null) => `${moduleId}|${track}`;

export default function ClientAssignProductPage() {
  const { companyId } = useParams<{ companyId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: client } = useQuery<Client>({ queryKey: ['client', companyId], queryFn: async () => (await api.get(`/api/customer-companies/${companyId}`)).data });
  const { data: products = [] } = useQuery<Purchased[]>({ queryKey: ['client-products', companyId], queryFn: async () => (await api.get(`/api/customer-companies/${companyId}/purchased-products`)).data });
  const { data: catalog = [] } = useQuery<CatProduct[]>({ queryKey: ['products'], queryFn: async () => (await api.get('/api/products')).data });
  const { data: staff = [] } = useQuery<StaffUser[]>({ queryKey: ['users'], queryFn: async () => (await api.get('/api/users')).data });

  const owned = new Set(products.map((p) => p.productId));
  const assignable = catalog.filter((c) => !owned.has(c.id));

  const [assign, setAssign] = useState<{ productId: string; coverageType: 'WARRANTY' | 'AMC'; startDate: string; endDate: string; supportHours: number; visits: number; contractAmount: number }>({ productId: '', coverageType: 'WARRANTY', startDate: today(), endDate: monthsFromNow(12), supportHours: 100, visits: 4, contractAmount: 100000 });

  // Consultant draft, pre-filled from the selected product's own module/product
  // consultants (a one-time snapshot the admin can edit before assigning).
  const assignProduct = catalog.find((c) => c.id === assign.productId);
  // The agent dropdown only offers agents assigned to this product in the Products screen.
  const productAgents = (() => {
    const byId = new Map<string, StaffUser>();
    for (const m of assignProduct?.modules ?? []) for (const a of m.consultants ?? []) byId.set(a.user.id, a.user);
    for (const a of assignProduct?.consultants ?? []) byId.set(a.user.id, a.user);
    return [...byId.values()];
  })();
  // The grid shows the product's module rows only — consultants are NOT pre-filled;
  // the admin assigns them from the dropdown (which offers only this product's agents).
  const [draftC, setDraftC] = useState<Draft[]>([]);
  useEffect(() => { setDraftC([]); }, [assign.productId]);
  const addConsultant = (moduleId: string | null, col: string, userId: string) => {
    const track = col === 'OTHERS' ? null : col;
    const id = `${moduleId}|${track}|${userId}`;
    const u = staff.find((s) => s.id === userId);
    setDraftC((d) => {
      if (d.some((x) => x.id === id)) return d;
      const firstInCell = !d.some((x) => cellKey(x.moduleId, x.track) === cellKey(moduleId, track));
      return [...d, { id, userId, username: u?.username ?? null, moduleId, track, isPrimary: firstInCell }];
    });
  };
  const removeDraftConsultant = (id: string) => setDraftC((d) => {
    const gone = d.find((x) => x.id === id);
    let next = d.filter((x) => x.id !== id);
    // Promote the next agent in the cell if the primary was removed.
    if (gone?.isPrimary) {
      const idx = next.findIndex((x) => cellKey(x.moduleId, x.track) === cellKey(gone.moduleId, gone.track));
      if (idx >= 0) next = next.map((x, i) => (i === idx ? { ...x, isPrimary: true } : x));
    }
    return next;
  });
  const setPrimaryDraft = (id: string) => setDraftC((d) => {
    const target = d.find((x) => x.id === id);
    if (!target) return d;
    return d.map((x) => (cellKey(x.moduleId, x.track) === cellKey(target.moduleId, target.track) ? { ...x, isPrimary: x.id === id } : x));
  });

  const [saving, setSaving] = useState(false);
  const doAssign = async () => {
    if (!assign.productId) return;
    if (assign.startDate && assign.endDate && assign.endDate <= assign.startDate) { toast.error('End date must be after the start date'); return; }
    setSaving(true);
    try {
      await api.post(`/api/customer-companies/${companyId}/purchased-products`, {
        productId: assign.productId, coverageType: assign.coverageType,
        startDate: assign.startDate, endDate: assign.endDate,
        supportHours: assign.supportHours, visits: assign.visits,
        ...(assign.coverageType === 'AMC' ? { contractAmount: assign.contractAmount } : {}),
      });
      for (const c of draftC) {
        await api.post(`/api/customer-companies/${companyId}/consultants`, {
          userId: c.userId, productId: assign.productId, moduleId: c.moduleId || undefined,
          track: c.track === 'TECHNICAL' || c.track === 'FUNCTIONAL' ? c.track : undefined,
          isPrimary: c.isPrimary,
        });
      }
      qc.invalidateQueries({ queryKey: ['client-products', companyId] });
      qc.invalidateQueries({ queryKey: ['client-consultants', companyId] });
      toast.success('Product assigned');
      navigate(`/admin/clients/${companyId}`);
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl">
      <Button variant="ghost" size="sm" onClick={() => navigate(`/admin/clients/${companyId}`)} className="mb-3 -ml-2">
        <ArrowLeft className="size-4" /> {client?.name ?? 'Client'}
      </Button>
      <h1 className="mb-6 text-2xl font-bold text-foreground">Assign a product</h1>

      <div className="space-y-6">
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Product</label>
          <Select value={assign.productId} onValueChange={(v) => setAssign({ ...assign, productId: v })}>
            <SelectTrigger className="max-w-sm"><SelectValue placeholder="Choose a product" /></SelectTrigger>
            <SelectContent>{assignable.length === 0 ? <SelectItem value="__none" disabled>All products assigned</SelectItem> : assignable.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>

        <RadioGroup value={assign.coverageType} onValueChange={(v) => setAssign({ ...assign, coverageType: v as 'WARRANTY' | 'AMC' })} className="flex gap-6">
          <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="WARRANTY" /> Under warranty <span className="text-xs text-muted-foreground">(free)</span></label>
          <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="AMC" /> Under AMC <span className="text-xs text-muted-foreground">(paid)</span></label>
        </RadioGroup>

        <div className="grid max-w-2xl grid-cols-2 gap-3">
          <Field label="Start date" type="date" value={assign.startDate} onChange={(v) => setAssign({ ...assign, startDate: v })} />
          <Field label="End date" type="date" min={assign.startDate || undefined} value={assign.endDate} onChange={(v) => setAssign({ ...assign, endDate: v })} />
          <Field label="Support hours" value={assign.supportHours} onChange={(v) => setAssign({ ...assign, supportHours: Number(v) })} />
          <Field label="No. of visits" value={assign.visits} onChange={(v) => setAssign({ ...assign, visits: Number(v) })} />
          {assign.coverageType === 'AMC' && (
            <Field label="Contract amount" value={assign.contractAmount} onChange={(v) => setAssign({ ...assign, contractAmount: Number(v) })} />
          )}
        </div>

        {assignProduct && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-sm font-medium"><Users className="size-4" /> Consultants for {assignProduct.name}</div>
            <p className="text-xs text-muted-foreground">Assign consultants per module and track — the dropdown offers only this product's agents. Saved when you assign the product.</p>
            <ConsultantGrid modules={assignProduct.modules ?? []} consultants={draftC} staff={productAgents} onAdd={addConsultant} onRemove={removeDraftConsultant} onPrimary={setPrimaryDraft} />
          </div>
        )}

        <div className="flex gap-2">
          <Button disabled={!assign.productId || saving} onClick={doAssign}><Plus className="size-4" /> {saving ? 'Assigning…' : 'Assign product'}</Button>
          <Button variant="outline" onClick={() => navigate(`/admin/clients/${companyId}`)}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = 'number', min }: { label: string; value: string | number; onChange: (v: string) => void; type?: string; min?: string | number }) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground">{label}</label>
      <Input type={type} min={min ?? (type === 'number' ? 0 : undefined)} value={value} onChange={(e) => onChange(e.target.value)} className="h-9" />
    </div>
  );
}
