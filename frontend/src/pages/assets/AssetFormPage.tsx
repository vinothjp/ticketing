import { useEffect, useState, type ReactNode } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft } from 'lucide-react';
import api from '../../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import PicklistSelect from '@/components/PicklistSelect';
import AssetAllocationGrid from '@/components/AssetAllocationGrid';
import AssetActivityTimeline from '@/components/AssetActivityTimeline';
import { ASSET_CONDITIONS, dateInputValue } from '../employees/employeeMeta';
import type { Asset } from './assetMeta';

/**
 * The form's own fields. Free text apart from the three dates and the two
 * classification fields (type, category), which come from option lists.
 */
const EMPTY = {
  assetId: '', assetName: '', description: '', assetType: '', assetCategory: '',
  serialNumber: '', manufacturer: '', model: '', barcode: '', poNumber: '',
  supplierName: '', invoiceNumber: '', lifespan: '', condition: 'OK',
  warrantyStart: '', warrantyEnd: '', purchaseDate: '',
};
type Form = typeof EMPTY;

export default function AssetFormPage() {
  const { id } = useParams();
  const isEditing = !!id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  // Adding from a type card on the overview carries that type through, so the
  // one field the card already knows is not retyped here.
  const [form, setForm] = useState<Form>(() => ({ ...EMPTY, assetType: params.get('type') ?? '' }));

  const { data: asset } = useQuery<Asset>({
    queryKey: ['asset', id],
    queryFn: async () => (await api.get(`/api/assets/${id}`)).data,
    enabled: isEditing,
  });

  // Keyed on the saved content, not the record object — a window-focus refetch
  // hands back a new object and would otherwise wipe what the admin was typing.
  const saved = JSON.stringify(asset ?? null);
  useEffect(() => {
    if (!asset) return;
    setForm({
      assetId: asset.assetId ?? '',
      assetName: asset.assetName ?? '',
      description: asset.description ?? '',
      assetType: asset.assetType ?? '',
      assetCategory: asset.assetCategory ?? '',
      serialNumber: asset.serialNumber ?? '',
      manufacturer: asset.manufacturer ?? '',
      model: asset.model ?? '',
      barcode: asset.barcode ?? '',
      poNumber: asset.poNumber ?? '',
      supplierName: asset.supplierName ?? '',
      invoiceNumber: asset.invoiceNumber ?? '',
      lifespan: asset.lifespan ?? '',
      condition: asset.condition ?? 'OK',
      warrantyStart: dateInputValue(asset.warrantyStart),
      warrantyEnd: dateInputValue(asset.warrantyEnd),
      purchaseDate: dateInputValue(asset.purchaseDate),
    });
  }, [saved]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (field: keyof Form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  const mutation = useMutation({
    mutationFn: async () => {
      // A date box the admin emptied must go as null, not '' — the DTO validates
      // it as a date string, and undefined would drop the clear entirely.
      const payload = {
        ...form,
        warrantyStart: form.warrantyStart || null,
        warrantyEnd: form.warrantyEnd || null,
        purchaseDate: form.purchaseDate || null,
      };
      return (isEditing
        ? await api.patch(`/api/assets/${id}`, payload)
        : await api.post('/api/assets', payload)).data;
    },
    onSuccess: (data: Asset) => {
      qc.invalidateQueries({ queryKey: ['assets'] });
      qc.invalidateQueries({ queryKey: ['asset', id] });
      toast.success(`Asset ${isEditing ? 'updated' : 'created'} successfully`);
      if (!isEditing) navigate(`/admin/assets/${data.id}/edit`, { replace: true });
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'An error occurred'),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.assetId.trim()) return toast.error('Asset ID is required');
    if (!form.assetName.trim()) return toast.error('Asset name is required');
    mutation.mutate();
  };

  const Req = () => <span className="text-destructive">*</span>;
  const field = (name: keyof Form, label: ReactNode, type = 'text') => (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} type={type} value={form[name]} onChange={set(name)} />
    </div>
  );
  // Type and category are the two classification fields, so they come from
  // option lists (/admin/options) rather than being typed. Everything else on
  // this form names one physical unit and stays free text.
  const listField = (name: keyof Form, label: ReactNode, listKey: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <PicklistSelect
        id={name} listKey={listKey} value={form[name]}
        onChange={(v) => setForm((f) => ({ ...f, [name]: v }))}
        placeholder={`Select ${String(label).toLowerCase()}...`}
      />
    </div>
  );

  // The unit's own condition, which outlives any one allocation: a broken return
  // sets Damaged, and clearing it back to OK here is how a repaired asset leaves
  // the "In repair" bucket on the overview.
  const conditionField = (
    <div className="space-y-1.5">
      <Label htmlFor="condition">Condition</Label>
      <Select value={form.condition} onValueChange={(v) => { if (v) setForm((f) => ({ ...f, condition: v })); }}>
        <SelectTrigger id="condition" className="w-full">
          <SelectValue placeholder="Select a condition..." />
        </SelectTrigger>
        <SelectContent>
          {ASSET_CONDITIONS.map((c) => (
            <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <div className="w-full">
      <Button variant="ghost" size="sm" className="mb-2 -ml-2" onClick={() => navigate('/admin/assets')}>
        <ArrowLeft className="size-4" /> All assets
      </Button>

      <div className="mb-4">
        <h1 className="text-2xl font-bold tracking-tight">
          {isEditing ? `${asset?.assetId ?? 'Asset'} — ${asset?.assetName ?? ''}` : 'New asset'}
        </h1>
        <p className="text-sm text-muted-foreground">
          The asset ID identifies this one physical unit, not its type, and is unique across your
          register.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-[8fr_12fr_8fr]">
          {field('assetId', <>Asset ID <Req /></>)}
          {field('assetName', <>Asset name <Req /></>)}
          {listField('assetType', 'Asset type', 'assetType')}
        </div>

        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          {listField('assetCategory', 'Asset category', 'assetCategory')}
          {field('serialNumber', 'Serial number')}
          {field('manufacturer', 'Manufacturer')}
          {field('model', 'Model')}
        </div>

        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          {field('barcode', 'Barcode / QR code')}
          {field('purchaseDate', 'Purchase date', 'date')}
          {field('poNumber', 'PO number')}
          {field('supplierName', 'Supplier name')}
        </div>

        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          {field('invoiceNumber', 'Invoice number')}
          {field('warrantyStart', 'Warranty start date', 'date')}
          {field('warrantyEnd', 'Warranty end date', 'date')}
          {field('lifespan', 'Lifespan')}
        </div>

        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          {conditionField}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="description">Asset description</Label>
          <Textarea id="description" rows={3} value={form.description} onChange={set('description')} />
        </div>

        <div className="flex justify-end gap-2 border-t pt-3">
          <Button type="button" variant="outline" onClick={() => navigate('/admin/assets')}>Cancel</Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : 'Save asset'}
          </Button>
        </div>
      </form>

      {/* The allocation is edited here, in Asset Master, over the very rows the
          employee's own screen shows — it is one record, not a copy, so a change
          made on either side is the change on both. Opening the employee is an
          explicit icon in the row, never the side effect of a click meant to
          edit. */}
      {isEditing && (
        <div className="mt-8 space-y-8">
          <AssetAllocationGrid assetId={id} />
          <AssetActivityTimeline assetId={id} />
        </div>
      )}
    </div>
  );
}
