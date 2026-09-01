import { useState, type ReactNode, type SyntheticEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Plus, Trash2, Barcode, Package, CircleDot, CalendarCheck, CalendarClock, IdCard,
  UserRound, Building, ShieldCheck, Timer, ExternalLink, RotateCcw,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import api from '../lib/api';
import { useConfirm } from '@/hooks/useConfirm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CellPopover } from '@/components/ui/cell-popover';
import {
  ALLOCATION_STATUSES, RETURN_CONDITIONS, RETENTIONS, allocationStatusLabel,
  allocationStatusPill, returnConditionLabel, returnConditionPill, retentionLabel,
  dateInputValue, isOverdue, personName,
} from '../pages/employees/employeeMeta';
import type { AssetAllocation, AssetOption, Employee } from '../pages/employees/employeeMeta';

const today = () => new Date().toISOString().slice(0, 10);

/** The bare-pill trigger every in-cell select shares. */
const BARE_TRIGGER =
  'w-auto gap-1 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 disabled:opacity-100 [&>svg]:opacity-0 [&>svg]:transition-opacity hover:[&>svg]:opacity-60 data-[state=open]:[&>svg]:opacity-60';

/**
 * The allocation grid, rendered from **both** masters over the same rows.
 *
 * Given `employeeUserId` it is "the assets this person holds"; given `assetId`,
 * "who has held this unit". Either way it reads and writes
 * `api/asset-allocations`, so an edit made on the asset screen is the same record
 * the employee screen shows — there is no second store to keep in step, and no
 * reason for one screen to bounce the admin to the other to make a change.
 *
 * An asset is one physical unit, so the Allocate control only offers what nobody
 * currently holds — and the server refuses a double allocation anyway, naming
 * whoever has it.
 */
export default function AssetAllocationGrid({
  employeeUserId, assetId,
}: {
  employeeUserId?: string;
  assetId?: string;
}) {
  const byEmployee = !!employeeUserId;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { confirm, ConfirmDialog } = useConfirm();
  const [addOpen, setAddOpen] = useState(false);
  const [picked, setPicked] = useState('');
  const [issuedDate, setIssuedDate] = useState(today);
  const [retention, setRetention] = useState('RETURNABLE');
  const [dueDate, setDueDate] = useState('');
  // Ticked rows, held as ids rather than indexes so a refetch that reorders or
  // drops an allocation can't silently retarget the selection.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkCondition, setBulkCondition] = useState('GOOD');

  const scope = employeeUserId ?? assetId ?? '';
  const { data: rows = [] } = useQuery<AssetAllocation[]>({
    queryKey: ['asset-allocations', byEmployee ? 'employee' : 'asset', scope],
    queryFn: async () =>
      (await api.get('/api/asset-allocations', {
        params: byEmployee ? { employeeUserId } : { assetId },
      })).data,
    enabled: !!scope,
  });

  // Only what is free can be allocated. Fetched when the dialog opens so the
  // list is current — an asset may have gone out while this page sat open.
  const { data: freeAssets = [] } = useQuery<AssetOption[]>({
    queryKey: ['assets', 'available'],
    queryFn: async () => (await api.get('/api/assets', { params: { available: true } })).data,
    enabled: addOpen && byEmployee,
  });

  // In asset mode the dialog picks a person instead. `/api/users` returns staff
  // only unless asked otherwise, and a customer contact is never an employee.
  const { data: staff = [] } = useQuery<Employee[]>({
    queryKey: ['employees'],
    queryFn: async () => (await api.get('/api/users')).data,
    enabled: addOpen && !byEmployee,
  });

  const held = rows.find((r) => r.status === 'ISSUED');

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['asset-allocations'] });
    qc.invalidateQueries({ queryKey: ['assets'] });
    qc.invalidateQueries({ queryKey: ['asset'] });
    qc.invalidateQueries({ queryKey: ['employees'] });
    qc.invalidateQueries({ queryKey: ['asset-activity'] });
  };

  const closeAdd = () => {
    setAddOpen(false);
    setPicked('');
    setRetention('RETURNABLE');
    setDueDate('');
  };

  const create = useMutation({
    mutationFn: () =>
      api.post('/api/asset-allocations', {
        assetId: byEmployee ? picked : assetId,
        employeeUserId: byEmployee ? employeeUserId : picked,
        status: 'ISSUED',
        retention,
        expectedReturnDate: retention === 'RETURNABLE' && dueDate ? dueDate : undefined,
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
  const openChosen = chosen.filter((r) => r.status === 'ISSUED');
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
  const runBulk = async (
    label: string,
    targets: AssetAllocation[],
    fn: (row: AssetAllocation) => Promise<unknown>,
  ) => {
    setBulkBusy(true);
    const failures: string[] = [];
    for (const row of targets) {
      try {
        await fn(row);
      } catch (e: any) {
        failures.push(e.response?.data?.message || 'failed');
      }
    }
    setBulkBusy(false);
    invalidate();
    clearSelection();
    const done = targets.length - failures.length;
    if (done) toast.success(`${label} ${done} ${done === 1 ? 'asset' : 'assets'}`);
    if (failures.length) toast.error(`${failures.length} failed · ${failures[0]}`);
  };

  const doBulkReturn = async (condition: string) => {
    await runBulk('Returned', openChosen, (row) =>
      api.patch(`/api/asset-allocations/${row.id}`, {
        status: 'RETURNED',
        returnCondition: condition,
        returnDate: today(),
      }));
    setBulkCondition('GOOD');
  };

  const bulkDelete = async () => {
    const ok = await confirm({
      title: `Remove ${chosen.length} ${chosen.length === 1 ? 'allocation' : 'allocations'}?`,
      description: 'The assets go back to the register and become allocatable again.',
      confirmText: 'Remove',
      destructive: true,
    });
    if (ok) await runBulk('Removed', chosen, (row) => api.delete(`/api/asset-allocations/${row.id}`));
  };

  const confirmRemove = async (row: AssetAllocation) => {
    const ok = await confirm({
      title: 'Remove this allocation?',
      description: `${row.assetCode ?? 'The asset'} goes back to the register and becomes allocatable again. The audit trail keeps the record.`,
      confirmText: 'Remove',
      destructive: true,
    });
    if (ok) remove.mutate(row.id);
  };

  const Dash = () => <span className="text-muted-foreground">—</span>;
  const cols = byEmployee ? 9 : 10;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-1.5 text-base font-semibold text-foreground">
          <Package className="size-4" /> {byEmployee ? 'Asset allocation' : 'Allocated to'}
        </h2>
      </div>

      <Dialog open={addOpen} onOpenChange={(o) => { if (!o) closeAdd(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{byEmployee ? 'Allocate an asset' : 'Allocate to an employee'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>{byEmployee ? 'Asset' : 'Employee'}</Label>
              {/* Radix resets a controlled value it cannot match while the list
                  loads and emits '' — a real pick is never empty, so ignore it. */}
              <Select value={picked || undefined} onValueChange={(v) => { if (v) setPicked(v); }}>
                <SelectTrigger className="w-full [&>span]:min-w-0 [&>span]:truncate">
                  <SelectValue placeholder={byEmployee ? 'Select an available asset...' : 'Select an employee...'} />
                </SelectTrigger>
                <SelectContent>
                  {byEmployee
                    ? freeAssets.map((a) => (
                        <SelectItem key={a.id} value={a.id}>{a.assetId} — {a.assetName}</SelectItem>
                      ))
                    : staff.map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {personName(u)}{u.employeeId ? ` (${u.employeeId})` : ''}
                        </SelectItem>
                      ))}
                </SelectContent>
              </Select>
              {byEmployee && freeAssets.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Every asset in the register is currently allocated.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Issued date</Label>
              <Input type="date" value={issuedDate} onChange={(e) => setIssuedDate(e.target.value)} />
            </div>

            {/* Some units are never handed back until the holder leaves. Saying
                so up front is what stops them reading as permanently overdue. */}
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
                  <Label htmlFor="dueDate">Due back (optional)</Label>
                  <Input id="dueDate" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeAdd}>Cancel</Button>
            <Button onClick={() => create.mutate()} disabled={!picked || create.isPending}>
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
            {/* Offered only when a pick can actually be returned — a settled row
                has nothing to hand back. */}
            {openChosen.length > 0 && (
              <CellPopover
                align="end"
                width={260}
                estimatedHeight={200}
                trigger={({ toggle }) => (
                  <Button size="sm" variant="outline" disabled={bulkBusy} onClick={toggle}>
                    <RotateCcw className="size-4" /> Return
                  </Button>
                )}
              >
                {(close) => (
                  <div className="space-y-3">
                    <p className="text-sm font-medium">
                      Return {openChosen.length} {openChosen.length === 1 ? 'asset' : 'assets'}
                    </p>
                    <RadioGroup value={bulkCondition} onValueChange={(v) => { if (v) setBulkCondition(v); }} className="gap-2">
                      {RETURN_CONDITIONS.map((c) => (
                        <label key={c.value} className="flex cursor-pointer items-center gap-2 text-sm">
                          <RadioGroupItem value={c.value} />
                          {c.label}
                        </label>
                      ))}
                    </RadioGroup>
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="ghost" onClick={close}>Cancel</Button>
                      <Button size="sm" onClick={() => { close(); doBulkReturn(bulkCondition); }}>Return</Button>
                    </div>
                  </div>
                )}
              </CellPopover>
            )}
            <Button size="sm" variant="outline" disabled={bulkBusy}
              className="text-destructive hover:text-destructive" onClick={bulkDelete}>
              <Trash2 className="size-4" /> Remove
            </Button>
            <Button size="sm" variant="ghost" disabled={bulkBusy} onClick={clearSelection}>Clear</Button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            {/* The name column takes w-full so it absorbs the slack: the rest
                size to their content instead of a gap spreading through every
                cell. */}
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
              {byEmployee ? (
                <>
                  <TableHead className="border-r"><HeadLabel icon={Barcode}>Asset code</HeadLabel></TableHead>
                  <TableHead className="w-full border-r"><HeadLabel icon={Package}>Asset name</HeadLabel></TableHead>
                </>
              ) : (
                <>
                  <TableHead className="border-r"><HeadLabel icon={IdCard}>Emp ID</HeadLabel></TableHead>
                  <TableHead className="w-full border-r"><HeadLabel icon={UserRound}>Employee name</HeadLabel></TableHead>
                  <TableHead className="border-r"><HeadLabel icon={Building}>Department</HeadLabel></TableHead>
                </>
              )}
              <TableHead className="border-r"><HeadLabel icon={CircleDot}>Status</HeadLabel></TableHead>
              <TableHead className="border-r"><HeadLabel icon={ShieldCheck}>Condition</HeadLabel></TableHead>
              <TableHead className="border-r"><HeadLabel icon={Timer}>Holding</HeadLabel></TableHead>
              <TableHead className="border-r"><HeadLabel icon={CalendarCheck}>Issued date</HeadLabel></TableHead>
              <TableHead className="border-r"><HeadLabel icon={CalendarClock}>Return date</HeadLabel></TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={cols} className="text-center text-muted-foreground">
                  {byEmployee ? 'No assets allocated yet.' : 'This asset has never been allocated.'}
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

                  {byEmployee ? (
                    <>
                      <TableCell className="border-r font-medium text-foreground">
                        <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{r.assetCode ?? '-'}</code>
                      </TableCell>
                      <TableCell className={`w-full border-r ${settled ? 'text-muted-foreground' : 'text-foreground'}`}>
                        <span className="block max-w-[18rem] truncate" title={r.assetName ?? undefined}>
                          {r.assetName ?? '-'}
                        </span>
                      </TableCell>
                    </>
                  ) : (
                    <>
                      <TableCell className="w-px border-r">
                        {r.employeeCode
                          ? <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{r.employeeCode}</code>
                          : <Dash />}
                      </TableCell>
                      <TableCell className={`w-full border-r ${settled ? 'text-muted-foreground' : 'font-medium text-foreground'}`}>
                        {/* Opening the employee is an explicit choice, never the
                            side effect of clicking a row you meant to edit. */}
                        <span className="flex items-center gap-1.5">
                          <span className="block max-w-[16rem] truncate" title={r.employeeName ?? undefined}>
                            {r.employeeName ?? '—'}
                          </span>
                          <Button
                            size="icon" variant="ghost" className="size-6 shrink-0 text-muted-foreground"
                            title={`Open ${r.employeeName ?? 'this employee'} in Employee Master`}
                            onClick={(e) => { e.stopPropagation(); navigate(`/admin/employees/${r.employeeUserId}`); }}
                          >
                            <ExternalLink className="size-3.5" />
                          </Button>
                        </span>
                      </TableCell>
                      <TableCell className="border-r">
                        {r.department
                          ? <span className="block max-w-[10rem] truncate" title={r.department}>{r.department}</span>
                          : <Dash />}
                      </TableCell>
                    </>
                  )}

                  <TableCell className="border-r" {...stop}>
                    <StatusCell row={r} onPatch={(data) => patch.mutate({ id: r.id, data })} />
                  </TableCell>

                  <TableCell className="border-r" {...stop}>
                    {settled ? (
                      <Select
                        value={r.returnCondition ?? 'GOOD'}
                        onValueChange={(v) => {
                          if (!v || v === r.returnCondition) return;
                          patch.mutate({ id: r.id, data: { returnCondition: v } });
                        }}
                      >
                        <SelectTrigger size="sm" className={BARE_TRIGGER}>
                          <span className={`rounded px-1.5 py-0.5 text-xs font-bold uppercase ${returnConditionPill(r.returnCondition)}`}>
                            {returnConditionLabel(r.returnCondition)}
                          </span>
                        </SelectTrigger>
                        <SelectContent>
                          {RETURN_CONDITIONS.map((c) => (
                            <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-muted-foreground" title="A condition is recorded when the asset comes back">—</span>
                    )}
                  </TableCell>

                  <TableCell className="border-r whitespace-nowrap" {...stop}>
                    <HoldingCell row={r} onPatch={(data) => patch.mutate({ id: r.id, data })} />
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
              <TableCell colSpan={cols} className="p-0">
                <button
                  type="button"
                  disabled={!byEmployee && !!held}
                  onClick={() => setAddOpen(true)}
                  title={!byEmployee && held ? `Already issued to ${held.employeeName ?? 'an employee'}` : undefined}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-muted-foreground hover:bg-muted/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
                >
                  <Plus className="size-4" />
                  {!byEmployee && held
                    ? `Issued to ${held.employeeName ?? 'an employee'} — return it first`
                    : byEmployee ? 'Allocate asset' : 'Allocate to an employee'}
                </button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-muted-foreground">
        An asset is one physical unit, so it can only be with one employee at a time. Mark a row{' '}
        <span className="font-medium text-foreground">Returned</span> to put it back in the register —
        a <span className="font-medium text-foreground">Broken</span> return also marks the unit damaged,
        which an admin clears on the asset once it is repaired.
      </p>

      {ConfirmDialog}
    </div>
  );
}

/**
 * Status, and the return it implies. Picking **Returned** opens a popover for the
 * date and condition rather than writing a bare status: a returned row with no
 * condition is exactly the ambiguity the old four-status model created.
 *
 * The popover is portalled (`CellPopover`) because the grid scrolls under
 * `overflow-x-auto`, which would otherwise clip anything opening out of a cell.
 */
function StatusCell({
  row, onPatch,
}: {
  row: AssetAllocation;
  onPatch: (data: Record<string, unknown>) => void;
}) {
  const [condition, setCondition] = useState('GOOD');
  const [date, setDate] = useState(today);

  const pill = (
    <span className={`rounded px-1.5 py-0.5 text-xs font-bold uppercase ${allocationStatusPill(row.status)}`}>
      {allocationStatusLabel(row.status)}
    </span>
  );

  return (
    <CellPopover
      align="start"
      width={260}
      estimatedHeight={230}
      trigger={({ toggle }) => (
        <Select
          value={row.status}
          onValueChange={(v) => {
            if (!v || v === row.status) return;
            if (v === 'RETURNED') {
              // Collect the condition and date first — the popover's Return
              // button is what actually writes.
              setCondition('GOOD');
              setDate(today());
              toggle();
              return;
            }
            onPatch({ status: v });
          }}
        >
          <SelectTrigger size="sm" className={BARE_TRIGGER}>{pill}</SelectTrigger>
          <SelectContent>
            {ALLOCATION_STATUSES.map((s) => (
              <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    >
      {(close) => (
        <div className="space-y-3">
          <p className="text-sm font-medium">Return {row.assetCode ?? 'this asset'}</p>
          <div className="space-y-1.5">
            <Label className="text-xs">Return date</Label>
            <Input type="date" className="h-8" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Condition</Label>
            <RadioGroup value={condition} onValueChange={(v) => { if (v) setCondition(v); }} className="gap-2">
              {RETURN_CONDITIONS.map((c) => (
                <label key={c.value} className="flex cursor-pointer items-center gap-2 text-sm">
                  <RadioGroupItem value={c.value} />
                  {c.label}
                  {c.value === 'BROKEN' && (
                    <span className="text-xs text-muted-foreground">— marks the unit damaged</span>
                  )}
                </label>
              ))}
            </RadioGroup>
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={close}>Cancel</Button>
            <Button
              size="sm"
              onClick={() => {
                onPatch({ status: 'RETURNED', returnCondition: condition, returnDate: date || null });
                close();
              }}
            >
              Return
            </Button>
          </div>
        </div>
      )}
    </CellPopover>
  );
}

/**
 * Whether the unit is expected back, and by when. An `UNTIL_EXIT` row is never
 * overdue by definition — that is the whole point of the flag.
 */
function HoldingCell({
  row, onPatch,
}: {
  row: AssetAllocation;
  onPatch: (data: Record<string, unknown>) => void;
}) {
  const [retention, setRetention] = useState(row.retention);
  const [due, setDue] = useState(dateInputValue(row.expectedReturnDate));

  const untilExit = row.retention === 'UNTIL_EXIT';
  const overdue = isOverdue(row);
  const label = untilExit
    ? retentionLabel('UNTIL_EXIT')
    : row.expectedReturnDate
      ? `Due ${dateInputValue(row.expectedReturnDate)}`
      : 'Returnable';
  const tone = untilExit
    ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300'
    : overdue
      ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
      : 'bg-muted text-muted-foreground';

  return (
    <CellPopover
      align="start"
      width={260}
      estimatedHeight={220}
      trigger={({ toggle }) => (
        <button
          type="button"
          onClick={() => {
            setRetention(row.retention);
            setDue(dateInputValue(row.expectedReturnDate));
            toggle();
          }}
          className={`rounded px-1.5 py-0.5 text-xs font-bold uppercase ${tone}`}
          title="Change how long this unit is held for"
        >
          {overdue ? 'Overdue' : label}
        </button>
      )}
    >
      {(close) => (
        <div className="space-y-3">
          <RadioGroup value={retention} onValueChange={(v) => { if (v) setRetention(v); }} className="gap-2">
            {RETENTIONS.map((r) => (
              <label key={r.value} className="flex cursor-pointer items-center gap-2 text-sm">
                <RadioGroupItem value={r.value} />
                {r.label}
              </label>
            ))}
          </RadioGroup>
          {retention === 'RETURNABLE' && (
            <div className="space-y-1.5">
              <Label className="text-xs">Due back (optional)</Label>
              <Input type="date" className="h-8" value={due} onChange={(e) => setDue(e.target.value)} />
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={close}>Cancel</Button>
            <Button
              size="sm"
              onClick={() => {
                onPatch({
                  retention,
                  expectedReturnDate: retention === 'UNTIL_EXIT' ? null : due || null,
                });
                close();
              }}
            >
              Save
            </Button>
          </div>
        </div>
      )}
    </CellPopover>
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
