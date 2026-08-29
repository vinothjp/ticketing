import { useEffect, useState, type ReactNode } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, IdCard, UserRound, Building, CircleDot, CalendarCheck, CalendarClock } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import api from '../../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import PicklistSelect from '@/components/PicklistSelect';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useDateFormat } from '@/lib/dateFormat';
import { allocationStatusLabel, allocationStatusPill, dateInputValue } from '../employees/employeeMeta';
import type { Asset, AssetHolder } from './assetMeta';

/**
 * The form's own fields. Free text apart from the three dates and the two
 * classification fields (type, category), which come from option lists.
 */
const EMPTY = {
  assetId: '', assetName: '', description: '', assetType: '', assetCategory: '',
  serialNumber: '', manufacturer: '', model: '', barcode: '', poNumber: '',
  supplierName: '', invoiceNumber: '', lifespan: '',
  warrantyStart: '', warrantyEnd: '', purchaseDate: '',
};
type Form = typeof EMPTY;

export default function AssetFormPage() {
  const { id } = useParams();
  const isEditing = !!id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { fmtDate } = useDateFormat();
  const [form, setForm] = useState<Form>(EMPTY);

  const { data: asset } = useQuery<Asset>({
    queryKey: ['asset', id],
    queryFn: async () => (await api.get(`/api/assets/${id}`)).data,
    enabled: isEditing,
  });

  // Who has held this asset. Read-only: the allocation itself is edited on the
  // employee's own screen, which is where each row links to.
  const { data: holders = [] } = useQuery<AssetHolder[]>({
    queryKey: ['asset-holders', id],
    queryFn: async () => (await api.get(`/api/assets/${id}/allocations`)).data,
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

      {isEditing && (
        <div className="mt-8 space-y-3">
          <div>
            <h2 className="flex items-center gap-1.5 text-base font-semibold text-foreground">
              <UserRound className="size-4" /> Allocated to
            </h2>
            <p className="text-sm text-muted-foreground">
              Read-only. Open a row to edit the allocation on that employee's screen.
            </p>
          </div>

          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="border-r"><HeadLabel icon={IdCard}>Emp ID</HeadLabel></TableHead>
                  <TableHead className="w-full border-r"><HeadLabel icon={UserRound}>Emp name</HeadLabel></TableHead>
                  <TableHead className="border-r"><HeadLabel icon={Building}>Department</HeadLabel></TableHead>
                  <TableHead className="border-r"><HeadLabel icon={CircleDot}>Allocation status</HeadLabel></TableHead>
                  <TableHead className="border-r"><HeadLabel icon={CalendarCheck}>Issued date</HeadLabel></TableHead>
                  <TableHead><HeadLabel icon={CalendarClock}>Return date</HeadLabel></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {holders.length === 0 ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      This asset has never been allocated.
                    </TableCell>
                  </TableRow>
                ) : holders.map((h) => (
                  <TableRow
                    key={h.id}
                    className="cursor-pointer"
                    title={`Open ${h.employeeName ?? 'this employee'} in Employee Master`}
                    onClick={() => navigate(`/admin/employees/${h.employeeUserId}`)}
                  >
                    <TableCell className="w-px border-r">
                      {h.employeeCode
                        ? <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{h.employeeCode}</code>
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="w-full border-r font-medium text-foreground">
                      <span className="block max-w-[16rem] truncate" title={h.employeeName ?? undefined}>
                        {h.employeeName ?? '—'}
                      </span>
                    </TableCell>
                    <TableCell className="border-r">
                      {h.department
                        ? <span className="block max-w-[10rem] truncate" title={h.department}>{h.department}</span>
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="border-r whitespace-nowrap">
                      <span className={`rounded px-1.5 py-0.5 text-xs font-bold uppercase ${allocationStatusPill(h.status)}`}>
                        {allocationStatusLabel(h.status)}
                      </span>
                    </TableCell>
                    <TableCell className="border-r whitespace-nowrap">
                      {h.issuedDate ? fmtDate(h.issuedDate) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {h.returnDate ? fmtDate(h.returnDate) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}

function HeadLabel({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
      <Icon className="size-3.5 shrink-0" />
      {children}
    </span>
  );
}
