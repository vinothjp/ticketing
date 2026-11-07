import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Paperclip, FileText, X, Plus, Users } from 'lucide-react';
import api from '../../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import ConsultantGrid from '@/components/ConsultantGrid';
import SupportHoursChoice from '@/components/SupportHoursChoice';
import SupportHoursConfig from '@/components/SupportHoursConfig';
import AutoAssignChoice from '@/components/AutoAssignChoice';
import ContractServicesConfig from '@/components/ContractServicesConfig';
import { servicesForm, servicesPayload, type ContractServicesValue } from '@/components/contractServices';

interface CatAgent { track: string; isPrimary?: boolean; user: { id: string; username: string; name?: string | null } }
interface CatModule { id: string; name: string; consultants: CatAgent[] }
interface CatProduct { id: string; name: string; imageUrl?: string | null; modules: CatModule[]; consultants: CatAgent[] }
interface Purchased { productId: string }
interface Client { id: string; name: string; clientType?: 'IMPLEMENTATION' | 'AMC'; contractScope?: 'PRODUCT' | 'CUSTOMER'; autoAssignTickets?: boolean }
interface StaffUser { id: string; username: string; name?: string | null }

const today = () => new Date().toISOString().slice(0, 10);
const monthsFromNow = (m: number) => { const d = new Date(); d.setMonth(d.getMonth() + m); return d.toISOString().slice(0, 10); };

type Draft = { id: string; userId: string; username: string | null; name: string | null; moduleId: string | null; track: string | null; isPrimary: boolean };
const cellKey = (moduleId: string | null, track: string | null) => `${moduleId}|${track}`;

export default function ClientAssignProductPage() {
  const { companyId } = useParams<{ companyId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: client } = useQuery<Client>({ queryKey: ['client', companyId], queryFn: async () => (await api.get(`/api/customer-companies/${companyId}`)).data });
  const { data: products = [] } = useQuery<Purchased[]>({ queryKey: ['client-products', companyId], queryFn: async () => (await api.get(`/api/customer-companies/${companyId}/purchased-products`)).data });
  const { data: catalog = [] } = useQuery<CatProduct[]>({ queryKey: ['products'], queryFn: async () => (await api.get('/api/products')).data });
  const { data: staff = [] } = useQuery<StaffUser[]>({ queryKey: ['users'], queryFn: async () => (await api.get('/api/users')).data });

  // On one shared customer contract the per-product dates/hours/visits are never
  // used — the contract owns them — so this form only picks the product and its
  // consultants, the same way ClientProductPage hides its Coverage/Terms.
  // An Implementation client has no terms to enter either: only the product is recorded.
  const impl = client?.clientType === 'IMPLEMENTATION';
  const customerScoped = impl || client?.contractScope === 'CUSTOMER';

  const owned = new Set(products.map((p) => p.productId));
  const assignable = catalog.filter((c) => !owned.has(c.id));

  // Warranty is free support, so the form opens on warranty with Unlimited hours.
  const [assign, setAssign] = useState<{ productId: string; coverageType: 'WARRANTY' | 'AMC'; startDate: string; endDate: string; supportHoursUnlimited: boolean; supportHours: number; visits: number; contractAmount: number; hoursPeriod: 'FULL_AMC' | 'MONTHLY'; carryForward: boolean; allowTicketsAfterHours: boolean; allowExcess: boolean; excessRate: number | ''; toleranceHours: number | '' }>({ productId: '', coverageType: 'WARRANTY', startDate: today(), endDate: monthsFromNow(12), supportHoursUnlimited: true, supportHours: 100, visits: 4, contractAmount: 100000, hoursPeriod: 'FULL_AMC', carryForward: false, allowTicketsAfterHours: true, allowExcess: false, excessRate: '', toleranceHours: '' });
  // Switching to warranty preselects Unlimited; AMC keeps the current choice.
  const onCoverage = (v: string) => {
    if (!v) return;
    const coverageType = v as 'WARRANTY' | 'AMC';
    setAssign((a) => ({ ...a, coverageType, supportHoursUnlimited: coverageType === 'WARRANTY' ? true : a.supportHoursUnlimited }));
  };

  // The rest of what ClientProductPage's Terms / Support hours settings cards
  // carry, so a product is assigned with the same fields it is later edited with.
  // Contract services ride the assign POST itself.
  const [services, setServices] = useState<ContractServicesValue>(servicesForm(null));
  // The PO saves itself on the product screen, but it hangs off the purchase,
  // which does not exist until Assign - so the number and invoice are held here
  // and written straight after the POST returns the new row's id.
  const [poNumber, setPoNumber] = useState('');
  const [poFile, setPoFile] = useState<File | null>(null);
  const poRef = useRef<HTMLInputElement>(null);
  // Auto assignment is a client-level switch (not this product's). On the product
  // screen it saves on click; here it waits for Assign, so Cancel leaves it alone.
  const [autoAssign, setAutoAssign] = useState<boolean | null>(null);
  const autoAssignValue = autoAssign ?? client?.autoAssignTickets ?? true;

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
      return [...d, { id, userId, username: u?.username ?? null, name: u?.name ?? null, moduleId, track, isPrimary: firstInCell }];
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
    if (!customerScoped) {
      if (assign.startDate && assign.endDate && assign.endDate <= assign.startDate) { toast.error('End date must be after the start date'); return; }
      if (!assign.supportHoursUnlimited && Number(assign.supportHours) <= 0) { toast.error('Enter support hours greater than 0, or choose Unlimited'); return; }
    }
    setSaving(true);
    try {
      const { data: created } = await api.post(`/api/customer-companies/${companyId}/purchased-products`, {
        productId: assign.productId,
        // Under a shared contract only the product itself is recorded — sending
        // terms here would write a per-product pool nothing reads.
        ...(customerScoped ? {} : {
          coverageType: assign.coverageType,
          startDate: assign.startDate, endDate: assign.endDate,
          // Unlimited carries no allocation at all.
          supportHoursUnlimited: assign.supportHoursUnlimited,
          ...(assign.supportHoursUnlimited ? {} : { supportHours: assign.supportHours }),
          visits: assign.visits,
          ...(assign.coverageType === 'AMC' ? { contractAmount: assign.contractAmount } : {}),
          // Support-hours config for the new pool.
          hoursPeriod: assign.hoursPeriod,
          carryForward: assign.hoursPeriod === 'MONTHLY' && assign.carryForward,
          allowTicketsAfterHours: assign.allowTicketsAfterHours,
          allowExcess: assign.allowExcess,
          ...(assign.allowExcess && assign.excessRate !== '' ? { excessRate: Number(assign.excessRate) } : {}),
          ...(assign.toleranceHours !== '' ? { toleranceHours: Number(assign.toleranceHours) } : {}),
          ...servicesPayload(services),
        }),
      });
      // The product is assigned from here on; a PO or switch that fails afterwards
      // is reported, not rolled back - both can be fixed on the product screen.
      const followUps: string[] = [];
      if (!customerScoped && created?.id) {
        const base = `/api/customer-companies/purchased-products/${created.id}`;
        if (poNumber.trim()) await api.patch(`${base}/po`, { poNumber: poNumber.trim() }).catch(() => followUps.push('purchase order'));
        if (poFile) {
          const fd = new FormData();
          fd.append('invoice', poFile);
          await api.post(`${base}/po-invoice`, fd).catch(() => followUps.push('PO invoice'));
        }
      }
      if (autoAssign !== null && autoAssign !== (client?.autoAssignTickets ?? true)) {
        await api.patch(`/api/customer-companies/${companyId}`, { autoAssignTickets: autoAssign })
          .then(() => qc.invalidateQueries({ queryKey: ['client', companyId] }))
          .catch(() => followUps.push('auto assignment'));
      }
      for (const c of draftC) {
        await api.post(`/api/customer-companies/${companyId}/consultants`, {
          userId: c.userId, productId: assign.productId, moduleId: c.moduleId || undefined,
          track: c.track === 'TECHNICAL' || c.track === 'FUNCTIONAL' ? c.track : undefined,
          isPrimary: c.isPrimary,
        });
      }
      qc.invalidateQueries({ queryKey: ['client-products', companyId] });
      qc.invalidateQueries({ queryKey: ['client-consultants', companyId] });
      if (followUps.length) toast.warning(`Product assigned, but the ${followUps.join(' and ')} could not be saved - set it on the product screen.`);
      else toast.success('Product assigned');
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

        {impl ? (
          <p className="max-w-2xl rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            This is an <span className="font-medium text-foreground">Implementation</span> client, so there are no warranty or
            AMC terms to enter — only the product and its consultants are recorded.
          </p>
        ) : customerScoped ? (
          <p className="max-w-2xl rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            This client is on <span className="font-medium text-foreground">one customer contract</span>, so coverage dates,
            support hours and visits come from that contract — there are no per-product terms to set. Tick the product under
            <span className="font-medium text-foreground"> Products covered</span> and save the contract to bring it under that coverage.
          </p>
        ) : (
          // Same two cards as ClientProductPage: what was agreed (left), how the
          // hours are governed and what else is covered (right), equal height.
          <div className="grid items-stretch gap-4 lg:grid-cols-2">
            <section className="flex h-full flex-col gap-3 rounded-lg border bg-card p-4">
              <h2 className="text-base font-semibold text-foreground">Terms</h2>
              <RadioGroup value={assign.coverageType} onValueChange={onCoverage} className="flex gap-5">
                <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="WARRANTY" /> Under warranty <span className="text-xs text-muted-foreground">(free)</span></label>
                <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="AMC" /> Under AMC <span className="text-xs text-muted-foreground">(paid)</span></label>
              </RadioGroup>
              <SupportHoursChoice unlimited={assign.supportHoursUnlimited} onChange={(u) => setAssign({ ...assign, supportHoursUnlimited: u })} />
              <div className="grid grid-cols-2 gap-2">
                <Field label="Start date" type="date" value={assign.startDate} onChange={(v) => setAssign({ ...assign, startDate: v })} />
                <Field label="End date" type="date" min={assign.startDate || undefined} value={assign.endDate} onChange={(v) => setAssign({ ...assign, endDate: v })} />
                {!assign.supportHoursUnlimited && (
                  <Field label={assign.hoursPeriod === 'MONTHLY' ? 'Support hours / month' : 'Support hours (for the term)'} min={1} value={assign.supportHours} onChange={(v) => setAssign({ ...assign, supportHours: Number(v) })} />
                )}
                <Field label="No. of visits / month" value={assign.visits} onChange={(v) => setAssign({ ...assign, visits: Number(v) })} />
                {assign.coverageType === 'AMC' && (
                  <Field label="Contract amount" value={assign.contractAmount} onChange={(v) => setAssign({ ...assign, contractAmount: Number(v) })} />
                )}
              </div>
              {/* Draft twin of PurchaseOrderFields: same look, saved on Assign. */}
              <div className="grid grid-cols-2 items-start gap-2">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Purchase order</label>
                  <Input className="h-8" value={poNumber} placeholder="PO-2026-0042" onChange={(e) => setPoNumber(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">PO invoice</label>
                  <input ref={poRef} type="file" accept="application/pdf,image/*" className="hidden"
                    onChange={(e) => { setPoFile(e.target.files?.[0] ?? null); e.target.value = ''; }} />
                  {poFile ? (
                    <div className="flex h-8 items-center gap-1.5 rounded-md border bg-muted/20 px-2">
                      <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground" title={poFile.name}>{poFile.name}</span>
                      <Button type="button" size="icon" variant="ghost" className="size-5 shrink-0" title="Remove this invoice" onClick={() => setPoFile(null)}>
                        <X className="size-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <Button type="button" variant="outline" className="h-8 w-full justify-start px-2 text-sm font-normal text-muted-foreground" onClick={() => poRef.current?.click()}>
                      <Paperclip className="size-3.5" /> Attach invoice
                    </Button>
                  )}
                </div>
              </div>
              <AutoAssignChoice value={autoAssignValue} disabled={!client} onChange={setAutoAssign} />
            </section>

            <section className="flex h-full flex-col gap-3 rounded-lg border bg-card p-4">
              <h2 className="text-base font-semibold text-foreground">Support hours settings</h2>
              {assign.supportHoursUnlimited ? (
                <p className="rounded-lg border bg-muted/20 p-3 text-sm text-muted-foreground">
                  Support hours are Unlimited — there is no allowance to count, cap or carry forward.
                </p>
              ) : (
                <SupportHoursConfig
                  value={{ hoursPeriod: assign.hoursPeriod, carryForward: assign.carryForward, allowTicketsAfterHours: assign.allowTicketsAfterHours, allowExcess: assign.allowExcess, excessRate: assign.excessRate, toleranceHours: assign.toleranceHours }}
                  onChange={(patch) => setAssign((a) => ({ ...a, ...patch }))}
                  showRate />
              )}
              <div className="mt-1 border-t pt-3">
                <h3 className="text-sm font-semibold text-foreground">Contract services</h3>
                <ContractServicesConfig value={services} onChange={(patch) => setServices((v) => ({ ...v, ...patch }))} />
              </div>
            </section>
          </div>
        )}

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
      <Input type={type} min={min ?? (type === 'number' ? 0 : undefined)} value={value} onChange={(e) => onChange(e.target.value)} className="h-8" />
    </div>
  );
}
