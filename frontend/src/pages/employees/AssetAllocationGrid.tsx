import { useState, type ReactNode, type SyntheticEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2, Barcode, Package, CircleDot, CalendarCheck, CalendarClock } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import api from '../../lib/api';
import { useConfirm } from '@/hooks/useConfirm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  ALLOCATION_STATUSES, allocationStatusLabel, allocationStatusPill, dateInputValue,
} from './employeeMeta';
import type { AssetAllocation, AssetOption } from './employeeMeta';

/**
 * The assets an employee is holding, in the same grid the ticket task section
 * uses. An asset is one physical unit, so the Allocate dialog only offers assets
 * nobody currently holds — and the server refuses a double allocation anyway,
 * naming whoever has it.
 */
export default function AssetAllocationGrid({ employeeUserId }: { employeeUserId: string }) {
  const qc = useQueryClient();
  const { confirm, ConfirmDialog } = useConfirm();
  const [addOpen, setAddOpen] = useState(false);
  const [pickedAsset, setPickedAsset] = useState('');
  const [issuedDate, setIssuedDate] = useState(() => new Date().toISOString().slice(0, 10));
  // Ticked rows, held as ids rather than indexes so a refetch that reorders or
  // drops an allocation can't silently retarget the selection.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const { data: rows = [] } = useQuery<AssetAllocation[]>({
    queryKey: ['asset-allocations', employeeUserId],
    queryFn: async () =>
      (await api.get('/api/asset-allocations', { params: { employeeUserId } })).data,
  });

  // Only what is free can be allocated. Fetched when the dialog opens so the
  // list is current — an asset may have gone out while this page sat open.
  const { data: freeAssets = [] } = useQuery<AssetOption[]>({
    queryKey: ['assets', 'available'],
    queryFn: async () => (await api.get('/api/assets', { params: { available: true } })).data,
    enabled: addOpen,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['asset-allocations'] });
    qc.invalidateQueries({ queryKey: ['assets'] });
    qc.invalidateQueries({ queryKey: ['employees'] });
  };

  const closeAdd = () => { setAddOpen(false); setPickedAsset(''); };

  const create = useMutation({
    mutationFn: () =>
      api.post('/api/asset-allocations', {
        assetId: pickedAsset,
        employeeUserId,
        status: 'ISSUED',
        issuedDate: issuedDate || undefined,
      }),
    onSuccess: () => { invalidate(); closeAdd(); toast.success('Asset allocated'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error allocating asset'),
  });

  const patch = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      api.patch(`/api/asset-allocations/${id}`, data),
    onSuccess: invalidate,
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error updating allocation'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/asset-allocations/${id}`),
    onSuccess: () => { invalidate(); toast.success('Allocation removed'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error removing allocation'),
  });

  const chosen = rows.filter((r) => selected.has(r.id));
  const allChosen = rows.length > 0 && chosen.length === rows.length;
  const toggleOne = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id); else next.delete(id);
      return next;
    });
  const toggleAll = (on: boolean) => setSelected(on ? new Set(rows.map((r) => r.id)) : new Set());
  const clearSelection = () => setSelected(new Set());

  /**
   * Bulk actions run one at a time, never `Promise.all` — each write re-checks
   * whether the asset is free, and concurrent requests race that check.
   */
  const runBulk = async (label: string, fn: (row: AssetAllocation) => Promise<unknown>) => {
    setBulkBusy(true);
    const failures: string[] = [];
    for (const row of chosen) {
      try {
        await fn(row);
      } catch (e: any) {
        failures.push(e.response?.data?.message || 'failed');
      }
    }
    setBulkBusy(false);
    invalidate();
    clearSelection();
    const done = chosen.length - failures.length;
    if (done) toast.success(`${label} ${done} ${done === 1 ? 'asset' : 'assets'}`);
    if (failures.length) toast.error(`${failures.length} failed · ${failures[0]}`);
  };

  const bulkStatus = (status: string) =>
    runBulk('Updated', (row) => api.patch(`/api/asset-allocations/${row.id}`, { status }));

  const bulkDelete = async () => {
    const ok = await confirm({
      title: `Remove ${chosen.length} ${chosen.length === 1 ? 'allocation' : 'allocations'}?`,
      description: 'The assets go back to the register and become allocatable again.',
      confirmText: 'Remove',
      destructive: true,
    });
    if (ok) await runBulk('Removed', (row) => api.delete(`/api/asset-allocations/${row.id}`));
  };

  const confirmRemove = async (row: AssetAllocation) => {
    const ok = await confirm({
      title: 'Remove this allocation?',
      description: `${row.assetCode ?? 'The asset'} goes back to the register and becomes allocatable again.`,
      confirmText: 'Remove',
      destructive: true,
    });
    if (ok) remove.mutate(row.id);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-1.5 text-base font-semibold text-foreground">
          <Package className="size-4" /> Asset allocation
        </h2>
      </div>

      <Dialog open={addOpen} onOpenChange={(o) => { if (!o) closeAdd(); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Allocate an asset</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Asset</label>
              {/* Radix resets a controlled value it cannot match while the list
                  loads and emits '' — a real pick is never empty, so ignore it. */}
              <Select value={pickedAsset || undefined} onValueChange={(v) => { if (v) setPickedAsset(v); }}>
                <SelectTrigger className="w-full [&>span]:min-w-0 [&>span]:truncate">
                  <SelectValue placeholder="Select an available asset..." />
                </SelectTrigger>
                <SelectContent>
                  {freeAssets.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.assetId} — {a.assetName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {freeAssets.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Every asset in the register is currently allocated.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Issued date</label>
              <Input type="date" value={issuedDate} onChange={(e) => setIssuedDate(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeAdd}>Cancel</Button>
            <Button onClick={() => create.mutate()} disabled={!pickedAsset || create.isPending}>
              Allocate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Present only while something is ticked, so the grid is uncluttered at
          rest and the actions appear exactly when they can be used. */}
      {chosen.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2">
          <span className="text-sm font-medium text-foreground">{chosen.length} selected</span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" disabled={bulkBusy}>Status</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {ALLOCATION_STATUSES.map((s) => (
                  <DropdownMenuItem key={s.value} onSelect={() => bulkStatus(s.value)}>
                    {s.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="sm" variant="outline" disabled={bulkBusy}
              className="text-destructive hover:text-destructive" onClick={bulkDelete}>
              <Trash2 className="size-4" /> Remove
            </Button>
            <Button size="sm" variant="ghost" disabled={bulkBusy} onClick={clearSelection}>Clear</Button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            {/* Asset name takes w-full so it absorbs the slack: the rest size to
                their content instead of a gap spreading through every cell. */}
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead className="border-r p-0">
                <div className="flex w-14 items-center justify-center">
                  <Checkbox
                    aria-label="Select all allocations"
                    disabled={rows.length === 0}
                    checked={allChosen ? true : chosen.length > 0 ? 'indeterminate' : false}
                    onCheckedChange={(v) => toggleAll(v === true)}
                  />
                </div>
              </TableHead>
              <TableHead className="border-r"><HeadLabel icon={Barcode}>Asset code</HeadLabel></TableHead>
              <TableHead className="w-full border-r"><HeadLabel icon={Package}>Asset name</HeadLabel></TableHead>
              <TableHead className="border-r"><HeadLabel icon={CircleDot}>Status</HeadLabel></TableHead>
              <TableHead className="border-r"><HeadLabel icon={CalendarCheck}>Issued date</HeadLabel></TableHead>
              <TableHead className="border-r"><HeadLabel icon={CalendarClock}>Return date</HeadLabel></TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  No assets allocated yet.
                </TableCell>
              </TableRow>
            ) : rows.map((r) => {
              // Every cell carrying a control stops the click, so using it never
              // also triggers the row.
              const stop = {
                onClick: (e: SyntheticEvent) => e.stopPropagation(),
                onKeyDown: (e: SyntheticEvent) => e.stopPropagation(),
              };
              const settled = r.status === 'RETURNED';
              return (
                <TableRow key={r.id} data-state={selected.has(r.id) ? 'selected' : undefined}>
                  <TableCell className="border-r p-0" {...stop}>
                    <div className="flex w-14 items-center justify-center py-3">
                      <Checkbox
                        aria-label={`Select ${r.assetCode ?? 'allocation'}`}
                        checked={selected.has(r.id)}
                        onCheckedChange={(v) => toggleOne(r.id, v === true)}
                      />
                    </div>
                  </TableCell>
                  <TableCell className="border-r font-medium text-foreground">
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{r.assetCode ?? '-'}</code>
                  </TableCell>
                  <TableCell className={`w-full border-r ${settled ? 'text-muted-foreground' : 'text-foreground'}`}>
                    <span className="block max-w-[18rem] truncate" title={r.assetName ?? undefined}>
                      {r.assetName ?? '-'}
                    </span>
                  </TableCell>

                  {/* A bare pill: the select's box, padding and shadow are
                      stripped so the status reads as the pill it is everywhere
                      else, with the chevron fading in on hover. */}
                  <TableCell className="border-r" {...stop}>
                    <Select
                      value={r.status}
                      onValueChange={(v) => { if (!v || v === r.status) return; patch.mutate({ id: r.id, data: { status: v } }); }}
                    >
                      <SelectTrigger
                        size="sm"
                        className="w-auto gap-1 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 disabled:opacity-100 [&>svg]:opacity-0 [&>svg]:transition-opacity hover:[&>svg]:opacity-60 data-[state=open]:[&>svg]:opacity-60"
                      >
                        <span className={`rounded px-1.5 py-0.5 text-xs font-bold uppercase ${allocationStatusPill(r.status)}`}>
                          {allocationStatusLabel(r.status)}
                        </span>
                      </SelectTrigger>
                      <SelectContent>
                        {ALLOCATION_STATUSES.map((s) => (
                          <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>

                  <TableCell className="border-r" {...stop}>
                    <Input
                      type="date"
                      className="h-8 w-[9.5rem]"
                      value={dateInputValue(r.issuedDate)}
                      onChange={(e) => patch.mutate({ id: r.id, data: { issuedDate: e.target.value || null } })}
                    />
                  </TableCell>
                  <TableCell className="border-r" {...stop}>
                    <Input
                      type="date"
                      className="h-8 w-[9.5rem]"
                      value={dateInputValue(r.returnDate)}
                      onChange={(e) => patch.mutate({ id: r.id, data: { returnDate: e.target.value || null } })}
                    />
                  </TableCell>

                  <TableCell {...stop}>
                    <Button
                      size="icon" variant="ghost" className="size-8 text-destructive hover:text-destructive"
                      title="Remove allocation"
                      onClick={() => confirmRemove(r)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}

            {/* The Allocate control lives in the table foot, not a toolbar band
                above it — same as the task grid's Add task row. */}
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={7} className="p-0">
                <button
                  type="button"
                  onClick={() => setAddOpen(true)}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                >
                  <Plus className="size-4" /> Allocate asset
                </button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-muted-foreground">
        An asset is one physical unit, so it can only be with one employee at a time. Mark a row{' '}
        <span className="font-medium text-foreground">Returned</span> to put it back in the register —
        Broken and Not returned still hold it.
      </p>

      {ConfirmDialog}
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
