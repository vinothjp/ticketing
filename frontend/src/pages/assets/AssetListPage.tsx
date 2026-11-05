import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Search, Plus, Pencil, Trash2, Barcode, Package, Tag, Layers, UserRound, HardDrive,
  CircleDot, X, ArrowUp, ArrowDown, ArrowUpDown, ChevronLeft, ChevronRight,
  UserRoundPlus, RotateCcw, LayoutGrid,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import api from '../../lib/api';
import { useConfirm } from '@/hooks/useConfirm';
import { useOptionValues } from '@/lib/optionLists';
import ImportExportBar from '@/components/ImportExportBar';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RETURN_CONDITIONS, RETENTIONS, assetConditionLabel, assetConditionPill, personName } from '../employees/employeeMeta';
import type { Employee } from '../employees/employeeMeta';
import { assetState, assetStateLabel, assetStatePill, ASSET_STATES } from './assetMeta';
import type { Asset } from './assetMeta';

const PAGE_SIZE = 25;

/** Radix cannot hold an empty SelectItem value, so each filter needs a sentinel. */
const ALL = '__all__';
/** The overview's card for assets with no type set — distinct from "no filter at all". */
const NONE = '__none__';

const today = () => new Date().toISOString().slice(0, 10);

type SortField = 'assetId' | 'assetName' | 'assetType' | 'assetCategory' | 'state' | 'holder';
type SortDir = 'asc' | 'desc';

/**
 * The asset register — one row per physical unit, its state and who is holding
 * it. This is the Asset Master landing screen; the by-type tiles are a view of
 * the same data, reached from the "By type" button.
 *
 * Filters sit in their own bar above the table, and every selection is held in
 * the URL — the same `?type=` / `?state=` params the by-type cards drill in with,
 * so a filter arrived at either way reads and clears the same.
 */
export default function AssetListPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { confirm, ConfirmDialog } = useConfirm();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [sortField, setSortField] = useState<SortField>('assetId');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [allocating, setAllocating] = useState<Asset | null>(null);
  const [returning, setReturning] = useState<Asset | null>(null);
  const [params, setParams] = useSearchParams();

  const type = params.get('type') ?? ALL;
  const category = params.get('category') ?? ALL;
  const state = params.get('state') ?? ALL;
  const anyFilter = type !== ALL || category !== ALL || state !== ALL;

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value === ALL) next.delete(key);
    else next.set(key, value);
    setParams(next);
  };
  const clearFilters = () => setParams({});

  const { data: assets = [], isLoading } = useQuery<Asset[]>({
    queryKey: ['assets'],
    queryFn: async () => (await api.get('/api/assets')).data,
  });

  // The classification lists back the two dropdowns, so a value an admin added on
  // /admin/options is offered before anything has been filed under it — the same
  // philosophy as the by-type view's empty cards.
  const listedTypes = useOptionValues('assetType');
  const listedCategories = useOptionValues('assetCategory');

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/assets/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assets'] });
      qc.invalidateQueries({ queryKey: ['asset-allocations'] });
      toast.success('Asset deleted');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error deleting asset'),
  });

  const invalidateAllocation = () => {
    qc.invalidateQueries({ queryKey: ['assets'] });
    qc.invalidateQueries({ queryKey: ['asset-allocations'] });
    qc.invalidateQueries({ queryKey: ['employees'] });
    qc.invalidateQueries({ queryKey: ['asset-activity'] });
  };

  /** The options for a classification dropdown: listed values, plus what is in use. */
  const optionsFor = (field: 'assetType' | 'assetCategory', listed: string[]) => {
    const seen = new Set(listed);
    let hasBlank = false;
    for (const a of assets) {
      const v = a[field]?.trim();
      if (v) seen.add(v); else hasBlank = true;
    }
    const out = [...seen].sort((a, b) => a.localeCompare(b));
    return { values: out, hasBlank };
  };

  const typeOptions = useMemo(() => optionsFor('assetType', listedTypes), [assets, listedTypes]);
  const categoryOptions = useMemo(() => optionsFor('assetCategory', listedCategories), [assets, listedCategories]);

  const filtered = useMemo(() => {
    const matches = (value: string | null | undefined, picked: string) => {
      if (picked === ALL) return true;
      const v = value?.trim();
      return v ? v === picked : picked === NONE;
    };
    const term = q.trim().toLowerCase();
    return assets.filter((a) =>
      matches(a.assetType, type) &&
      matches(a.assetCategory, category) &&
      (state === ALL || assetState(a) === state) &&
      (!term ||
        [a.assetId, a.assetName, a.assetType, a.assetCategory, a.serialNumber, a.manufacturer, a.model,
          a.allocation?.employeeName]
          .some((v) => v?.toLowerCase().includes(term))),
    );
  }, [assets, q, type, category, state]);

  const rows = useMemo(() => {
    // A blank cell sorts to the bottom in *both* directions — flipping the
    // direction is meant to reorder the values, not bury them under the dashes.
    const text = (a: Asset) =>
      sortField === 'assetId' ? a.assetId
      : sortField === 'assetName' ? a.assetName
      : sortField === 'assetType' ? a.assetType ?? ''
      : sortField === 'assetCategory' ? a.assetCategory ?? ''
      : sortField === 'state' ? assetStateLabel(assetState(a))
      : a.allocation?.employeeName ?? '';

    return [...filtered].sort((a, b) => {
      const va = text(a);
      const vb = text(b);
      if (!va && !vb) return 0;
      if (!va) return 1;
      if (!vb) return -1;
      const cmp = va.localeCompare(vb, undefined, { numeric: true, sensitivity: 'base' });
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sortField, sortDir]);

  // A narrowed filter — or a re-sort — can leave the viewer stranded past the
  // last page, or looking at a page of rows they did not pick.
  useEffect(() => { setPage(1); }, [q, sortField, sortDir, params]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paged = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortField(field); setSortDir('asc'); }
  };

  const askDelete = async (a: Asset) => {
    const ok = await confirm({
      title: 'Delete this asset?',
      description: `${a.assetId} — ${a.assetName}, its allocation history and its audit trail will be removed.`,
      confirmText: 'Delete',
      destructive: true,
    });
    if (ok) remove.mutate(a.id);
  };

  const Dash = () => <span className="text-muted-foreground">—</span>;
  const headProps = { sortField, sortDir, onSort: handleSort };

  return (
    <div className="w-full">
      <div className="mb-4 min-w-0">
        <h1 className="text-2xl font-bold tracking-tight">Asset Master</h1>
        <p className="text-sm text-muted-foreground">
          {rows.length} {rows.length === 1 ? 'asset' : 'assets'}. Each is one physical unit,
          identified by its own asset ID.
        </p>
      </div>

      {/* Filters have their own bar rather than living in the column headings —
          one row of labelled controls, in the shape the other list screens use. */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search assets…" className="pl-8" />
        </div>

        {/* A real pick is never empty — ignore the '' Radix emits while the
            option lists are still loading, or it wipes the current filter. */}
        <Select value={type} onValueChange={(v) => { if (v) setFilter('type', v); }}>
          <SelectTrigger className="w-48 [&>span]:min-w-0 [&>span]:truncate">
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All types</SelectItem>
            {typeOptions.values.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
            {typeOptions.hasBlank && <SelectItem value={NONE}>(Unclassified)</SelectItem>}
          </SelectContent>
        </Select>

        <Select value={category} onValueChange={(v) => { if (v) setFilter('category', v); }}>
          <SelectTrigger className="w-48 [&>span]:min-w-0 [&>span]:truncate">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All categories</SelectItem>
            {categoryOptions.values.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
            {categoryOptions.hasBlank && <SelectItem value={NONE}>(Unclassified)</SelectItem>}
          </SelectContent>
        </Select>

        <Select value={state} onValueChange={(v) => { if (v) setFilter('state', v); }}>
          <SelectTrigger className="w-40 [&>span]:min-w-0 [&>span]:truncate">
            <SelectValue placeholder="All states" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All states</SelectItem>
            {ASSET_STATES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>

        {(anyFilter || q) && (
          <Button variant="ghost" size="sm" onClick={() => { setQ(''); clearFilters(); }} title="Show every asset">
            <X className="size-4" /> Clear filters
          </Button>
        )}

        {/* The actions share the filter row rather than sitting up beside the
            page title — same one-row shape the Employee Master uses. */}
        <Button variant="outline" onClick={() => navigate('/admin/assets/types')}>
          <LayoutGrid className="size-4" /> By type
        </Button>
        <ImportExportBar
          noun="assets"
          templateName="asset-import-template.xlsx"
          exportUrl="/api/assets/export"
          templateUrl="/api/assets/import-template"
          importUrl="/api/assets/import"
          onImported={invalidateAllocation}
        />
        <Button onClick={() => navigate(`/admin/assets/new${type !== ALL && type !== NONE ? `?type=${encodeURIComponent(type)}` : ''}`)}>
          <Plus className="size-4" /> New asset
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-12 text-center">
          <HardDrive className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {q || anyFilter ? 'No assets match your filters.' : 'No assets in the register yet.'}
          </p>
          {q || anyFilter ? (
            <Button variant="outline" size="sm" onClick={() => { setQ(''); clearFilters(); }}>
              <X className="size-4" /> Clear filters
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => navigate('/admin/assets/new')}>
              <Plus className="size-4" /> Add the first asset
            </Button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <SortableHead icon={Barcode} label="Asset ID" field="assetId" {...headProps} />
                <SortableHead icon={Package} label="Asset name" field="assetName" className="w-full" {...headProps} />
                <SortableHead icon={Tag} label="Type" field="assetType" {...headProps} />
                <SortableHead icon={Layers} label="Category" field="assetCategory" {...headProps} />
                <SortableHead icon={CircleDot} label="State" field="state" {...headProps} />
                <SortableHead icon={UserRound} label="Allocated to" field="holder" {...headProps} />
                <TableHead className="w-px text-right text-xs font-semibold text-muted-foreground">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.map((a) => {
                const state = assetState(a);
                const held = a.allocation;
                return (
                  <TableRow
                    key={a.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/admin/assets/${a.id}/edit`)}
                  >
                    <TableCell className="w-px border-r">
                      <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{a.assetId}</code>
                    </TableCell>
                    <TableCell className="w-full border-r font-medium text-foreground">
                      <span className="block max-w-[18rem] truncate" title={a.assetName}>{a.assetName}</span>
                    </TableCell>
                    <TableCell className="border-r">
                      {a.assetType
                        ? <span className="block max-w-[10rem] truncate" title={a.assetType}>{a.assetType}</span>
                        : <Dash />}
                    </TableCell>
                    <TableCell className="border-r">
                      {a.assetCategory
                        ? <span className="block max-w-[10rem] truncate" title={a.assetCategory}>{a.assetCategory}</span>
                        : <Dash />}
                    </TableCell>

                    {/* Where the unit *is* — and, separately, what condition it is
                        in. A unit can be out with someone and damaged at once, so
                        the condition rides alongside the state instead of
                        overwriting it; a damaged unit sitting free reads as
                        "In repair" on its own and needs no second pill. */}
                    <TableCell className="border-r whitespace-nowrap">
                      <span className="flex items-center gap-1">
                        <span className={`rounded px-1.5 py-0.5 text-xs font-bold uppercase ${assetStatePill(state)}`}>
                          {assetStateLabel(state)}
                        </span>
                        {a.condition !== 'OK' && state === 'IN_USE' && (
                          <span
                            className={`rounded px-1.5 py-0.5 text-xs font-bold uppercase ${assetConditionPill(a.condition)}`}
                            title={`This unit is marked ${assetConditionLabel(a.condition).toLowerCase()}`}
                          >
                            {assetConditionLabel(a.condition)}
                          </span>
                        )}
                      </span>
                    </TableCell>

                    {/* Just who has it: the State column already says whether it
                        is out, so an "Issued" pill here would be the same fact
                        twice. Taking it back is the Return action. */}
                    <TableCell className="border-r whitespace-nowrap">
                      {held ? (
                        <span className="flex items-center gap-2">
                          <span className="block max-w-[12rem] truncate" title={held.employeeName ?? undefined}>
                            {held.employeeName ?? '—'}
                          </span>
                          {held.retention === 'UNTIL_EXIT' && (
                            <span
                              className="rounded bg-indigo-100 px-1.5 py-0.5 text-xs font-bold uppercase text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300"
                              title="Held for the whole employment — collected on exit"
                            >
                              Until exit
                            </span>
                          )}
                        </span>
                      ) : (
                        <Dash />
                      )}
                    </TableCell>

                    <TableCell className="w-px text-right">
                      <div className="flex items-center justify-end gap-1">
                        {held ? (
                          <Button
                            variant="ghost" size="icon" className="size-8"
                            title={`Return ${a.assetId} from ${held.employeeName ?? 'its holder'}`}
                            onClick={(e) => { e.stopPropagation(); setReturning(a); }}
                          >
                            <RotateCcw className="size-4" />
                          </Button>
                        ) : (
                          <Button
                            variant="ghost" size="icon" className="size-8"
                            title={`Allocate ${a.assetId} to an employee`}
                            onClick={(e) => { e.stopPropagation(); setAllocating(a); }}
                          >
                            <UserRoundPlus className="size-4" />
                          </Button>
                        )}
                        <Button
                          variant="ghost" size="icon" className="size-8"
                          title={`Edit ${a.assetId}`}
                          onClick={(e) => { e.stopPropagation(); navigate(`/admin/assets/${a.id}/edit`); }}
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          variant="ghost" size="icon"
                          className="size-8 text-muted-foreground hover:text-destructive"
                          title={`Delete ${a.assetId}`}
                          onClick={(e) => { e.stopPropagation(); askDelete(a); }}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          <div className="flex items-center justify-between border-t px-4 py-3">
            <span className="text-sm text-muted-foreground">
              Page {currentPage} of {totalPages} · {rows.length} {rows.length === 1 ? 'asset' : 'assets'}
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={currentPage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}>
                <ChevronLeft className="size-4" /> Prev
              </Button>
              <Button size="sm" variant="outline" disabled={currentPage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                Next <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      )}

      <AllocateDialog asset={allocating} onClose={() => setAllocating(null)} onDone={invalidateAllocation} />
      <ReturnDialog asset={returning} onClose={() => setReturning(null)} onDone={invalidateAllocation} />

      {ConfirmDialog}
    </div>
  );
}

/**
 * A sortable column heading, in the same mould as Employee Master's: the column's
 * own icon leads, the sort indicator trails. Filtering is the bar above, not
 * something buried in here.
 */
function SortableHead({
  label, field, sortField, sortDir, onSort, icon: Icon, className = '',
}: {
  label: string;
  field: SortField;
  sortField: SortField;
  sortDir: SortDir;
  onSort: (field: SortField) => void;
  icon: LucideIcon;
  className?: string;
}) {
  const active = sortField === field;
  return (
    <TableHead className={`border-r ${className}`}>
      <button
        type="button"
        onClick={() => onSort(field)}
        className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
      >
        <Icon className="size-3.5 shrink-0" />
        {label}
        {active ? (
          sortDir === 'asc' ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />
        ) : (
          <ArrowUpDown className="size-3.5 opacity-40" />
        )}
      </button>
    </TableHead>
  );
}

/** Issue a free unit straight from the register, without a detour via Employee Master. */
function AllocateDialog({
  asset, onClose, onDone,
}: {
  asset: Asset | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [employee, setEmployee] = useState('');
  const [issuedDate, setIssuedDate] = useState(today);
  const [retention, setRetention] = useState('RETURNABLE');
  const [dueDate, setDueDate] = useState('');

  const { data: staff = [] } = useQuery<Employee[]>({
    queryKey: ['employees'],
    queryFn: async () => (await api.get('/api/users')).data,
    enabled: !!asset,
  });

  const close = () => {
    onClose();
    setEmployee('');
    setRetention('RETURNABLE');
    setDueDate('');
    setIssuedDate(today());
  };

  const create = useMutation({
    mutationFn: () =>
      api.post('/api/asset-allocations', {
        assetId: asset!.id,
        employeeUserId: employee,
        status: 'ISSUED',
        retention,
        expectedReturnDate: retention === 'RETURNABLE' && dueDate ? dueDate : undefined,
        issuedDate: issuedDate || undefined,
      }),
    onSuccess: () => { onDone(); close(); toast.success('Asset allocated'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error allocating asset'),
  });

  return (
    <Dialog open={!!asset} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Allocate {asset?.assetId}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{asset?.assetName}</p>
          <div className="space-y-1.5">
            <Label>Employee</Label>
            {/* Radix resets a controlled value it cannot match while the list
                loads and emits '' — a real pick is never empty, so ignore it. */}
            <Select value={employee || undefined} onValueChange={(v) => { if (v) setEmployee(v); }}>
              <SelectTrigger className="w-full [&>span]:min-w-0 [&>span]:truncate">
                <SelectValue placeholder="Select an employee..." />
              </SelectTrigger>
              <SelectContent>
                {staff.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {personName(u)}{u.employeeId ? ` (${u.employeeId})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Issued date</Label>
            <Input type="date" value={issuedDate} onChange={(e) => setIssuedDate(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Holding</Label>
            <RadioGroup value={retention} onValueChange={(v) => { if (v) setRetention(v); }} className="gap-2">
              {RETENTIONS.map((r) => (
                <label key={r.value} className="flex cursor-pointer items-center gap-2 text-sm">
                  <RadioGroupItem value={r.value} />
                  <span>{r.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {r.value === 'UNTIL_EXIT'
                      ? '— kept for the whole employment, collected on exit'
                      : '— expected back, optionally by a date'}
                  </span>
                </label>
              ))}
            </RadioGroup>
            {retention === 'RETURNABLE' && (
              <div className="space-y-1.5 pt-1">
                <Label htmlFor="allocDue">Due back (optional)</Label>
                <Input id="allocDue" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close}>Cancel</Button>
          <Button onClick={() => create.mutate()} disabled={!employee || create.isPending}>Allocate</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Take a unit back, recording the condition it came back in. */
function ReturnDialog({
  asset, onClose, onDone,
}: {
  asset: Asset | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [condition, setCondition] = useState('GOOD');
  const [date, setDate] = useState(today);

  const close = () => { onClose(); setCondition('GOOD'); setDate(today()); };

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/api/asset-allocations/${asset!.allocation!.id}`, {
        status: 'RETURNED',
        returnCondition: condition,
        returnDate: date || null,
      }),
    onSuccess: () => { onDone(); close(); toast.success('Asset returned'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error returning asset'),
  });

  return (
    <Dialog open={!!asset} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Return {asset?.assetId}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            From {asset?.allocation?.employeeName ?? 'its holder'}.
          </p>
          <div className="space-y-1.5">
            <Label>Return date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Condition</Label>
            <RadioGroup value={condition} onValueChange={(v) => { if (v) setCondition(v); }} className="gap-2">
              {RETURN_CONDITIONS.map((c) => (
                <label key={c.value} className="flex cursor-pointer items-center gap-2 text-sm">
                  <RadioGroupItem value={c.value} />
                  <span>{c.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {c.value === 'BROKEN'
                      ? '— marks the unit damaged until an admin clears it'
                      : '— straight back into the register'}
                  </span>
                </label>
              ))}
            </RadioGroup>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>Return</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
