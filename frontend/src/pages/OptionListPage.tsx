import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Pencil, Trash2, Search, RotateCcw, List, Hash, Tag, Boxes,
  CircleDot, Layers, Check, X, ListOrdered, AlignLeft, CornerDownRight,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import api from '../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';

/**
 * A column heading: its icon, then its label. Muted and small, so the headings
 * read as chrome and the values below them carry the weight. Mirrors the task
 * grid on the ticket detail screen.
 */
function HeadLabel({ icon: Icon, children, className = '' }: {
  icon: LucideIcon; children: ReactNode; className?: string;
}) {
  return (
    <span className={`flex items-center gap-1.5 text-xs font-semibold text-muted-foreground ${className}`}>
      <Icon className="size-3.5 shrink-0" />
      {children}
    </span>
  );
}

interface OptionList {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  source: string;
  /** Screen area — the Module column and filter. Separate from `source`, the value store. */
  module: string;
  sourceLabel: string;
  listKey: string;
  parentListKey?: string | null;
  allowCustom: boolean;
  isSystem: boolean;
  isActive: boolean;
  valueCount: number;
}

interface OptionValue {
  id: string;
  code: string;
  description: string;
  parentValue: string | null;
  isActive: boolean;
  seq: number;
}

// Mirrors `MODULES` in `backend/src/option-lists/default-lists.ts`. A module is a
// screen area, not a value store: Organization writes into PicklistOption exactly
// as Ticketing does, which is what lets it be its own module without a third table.
const MODULES = [
  { value: 'TICKETING', label: 'Ticketing' },
  { value: 'CHANGE_MGMT', label: 'Change Mgmt' },
  { value: 'KNOWLEDGE_BASE', label: 'Knowledge Base' },
  { value: 'PROJECTS', label: 'Projects' },
  { value: 'ORGANIZATION', label: 'Organization' },
];

const emptyList = {
  code: '', name: '', description: '', module: 'TICKETING', allowCustom: false, isActive: true,
};

// The pill every list screen uses for a state column: bold, uppercase, colour-coded.
function ActivePill({ active }: { active: boolean }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-bold uppercase ${
      active
        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
        : 'bg-muted text-muted-foreground'
    }`}>
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

/**
 * The tenant's single Option List screen: every dropdown list in the platform —
 * ticketing/KB picklists and the Change Management lists alike — in one
 * registry, with its values edited in the Values dialog. The two older screens
 * (Picklist Options, Change Mgmt Options) were folded into this one; their
 * routes now redirect here.
 */
export default function OptionListPage() {
  const qc = useQueryClient();
  const [codeQ, setCodeQ] = useState('');
  const [nameQ, setNameQ] = useState('');
  const [status, setStatus] = useState('ALL');
  const [module, setModule] = useState('ALL');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<OptionList | null>(null);
  const [form, setForm] = useState<typeof emptyList>(emptyList);
  const [valuesFor, setValuesFor] = useState<OptionList | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const { data: lists = [], isLoading } = useQuery<OptionList[]>({
    queryKey: ['option-lists'],
    queryFn: async () => (await api.get('/api/option-lists')).data,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['option-lists'] });

  const filtered = useMemo(() => {
    const code = codeQ.trim().toLowerCase();
    const name = nameQ.trim().toLowerCase();
    return lists.filter((l) =>
      (!code || l.code.toLowerCase().includes(code)) &&
      (!name || l.name.toLowerCase().includes(name)) &&
      (status === 'ALL' || (status === 'ACTIVE') === l.isActive) &&
      (module === 'ALL' || l.module === module));
  }, [lists, codeQ, nameQ, status, module]);

  // Narrowing the filters can leave the current page past the end, so the page
  // in play is always clamped and every filter change returns to the first page.
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(page, pageCount);
  const start = (current - 1) * pageSize;
  const paged = filtered.slice(start, start + pageSize);
  useEffect(() => { setPage(1); }, [codeQ, nameQ, status, module, pageSize]);

  // The open dialog re-reads its list from the query, so a rename or a fresh
  // value count lands in the dialog title without reopening it.
  const openList = valuesFor ? lists.find((l) => l.id === valuesFor.id) ?? valuesFor : null;

  const saveMutation = useMutation({
    mutationFn: () => {
      const body = {
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        description: form.description.trim(),
        allowCustom: form.allowCustom,
        isActive: form.isActive,
      };
      return editing
        // A built-in list is read by key in application code, so its code is fixed.
        ? api.patch(`/api/option-lists/${editing.id}`, editing.isSystem ? { ...body, code: undefined } : body)
        // The module names the store, so `source` is left for the server to derive.
        : api.post('/api/option-lists', { ...body, module: form.module });
    },
    onSuccess: () => {
      invalidate();
      setFormOpen(false);
      setEditing(null);
      toast.success(editing ? 'Option list saved' : 'Option list created');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error saving option list'),
  });

  const toggleMutation = useMutation({
    mutationFn: (l: OptionList) => api.patch(`/api/option-lists/${l.id}`, { isActive: !l.isActive }),
    onSuccess: invalidate,
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error updating option list'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/option-lists/${id}`),
    onSuccess: () => { invalidate(); toast.success('Option list deleted'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error deleting option list'),
  });

  const openCreate = () => { setEditing(null); setForm(emptyList); setFormOpen(true); };
  const openEdit = (l: OptionList) => {
    setEditing(l);
    setForm({
      code: l.code, name: l.name, description: l.description ?? '',
      module: l.module, allowCustom: l.allowCustom, isActive: l.isActive,
    });
    setFormOpen(true);
  };
  const reset = () => { setCodeQ(''); setNameQ(''); setStatus('ALL'); setModule('ALL'); };

  return (
    <div>
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Option List</h1>
          <p className="text-sm text-muted-foreground">
            {filtered.length} record(s) — every dropdown list in the platform, ticketing and
            Change Management alike.
          </p>
        </div>
        <Button onClick={openCreate}><Plus className="size-4" /> New Option</Button>
      </div>

      {/* Filter bar: code, name, status, module — mirrors the list screens' search row. */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-3">
        <div className="relative w-56">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={codeQ} onChange={(e) => setCodeQ(e.target.value)} placeholder="Search by Code" className="bg-background pl-8" />
        </div>
        <div className="relative w-56">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={nameQ} onChange={(e) => setNameQ(e.target.value)} placeholder="Search by Name" className="bg-background pl-8" />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-40 bg-background"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            <SelectItem value="ACTIVE">Active</SelectItem>
            <SelectItem value="INACTIVE">Inactive</SelectItem>
          </SelectContent>
        </Select>
        <Select value={module} onValueChange={setModule}>
          <SelectTrigger className="w-40 bg-background"><SelectValue placeholder="Module" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All modules</SelectItem>
            {MODULES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={reset}><RotateCcw className="size-4" /> Reset</Button>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="border-r"><HeadLabel icon={Hash}>Code</HeadLabel></TableHead>
                <TableHead className="w-full border-r"><HeadLabel icon={Tag}>Name</HeadLabel></TableHead>
                <TableHead className="border-r"><HeadLabel icon={Boxes}>Module</HeadLabel></TableHead>
                <TableHead className="border-r"><HeadLabel icon={Layers}>Allow Custom</HeadLabel></TableHead>
                <TableHead className="border-r"><HeadLabel icon={ListOrdered} className="justify-end">Values</HeadLabel></TableHead>
                <TableHead className="border-r"><HeadLabel icon={CircleDot}>Active</HeadLabel></TableHead>
                <TableHead className="text-right text-xs font-semibold text-muted-foreground">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    No option lists match these filters.
                  </TableCell>
                </TableRow>
              )}
              {paged.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="w-px border-r">
                    <span className="font-mono text-xs font-semibold text-primary">{l.code}</span>
                  </TableCell>
                  <TableCell className="w-full border-r font-medium text-foreground">
                    <span className="block max-w-[22rem] truncate" title={l.description || l.name}>{l.name}</span>
                  </TableCell>
                  <TableCell className="w-px border-r text-muted-foreground">{l.sourceLabel}</TableCell>
                  <TableCell className="w-px border-r">
                    <span className={l.allowCustom ? 'text-primary' : 'text-muted-foreground'}>
                      {l.allowCustom ? 'Yes' : 'No'}
                    </span>
                  </TableCell>
                  <TableCell className="w-px border-r text-right tabular-nums text-muted-foreground">{l.valueCount}</TableCell>
                  <TableCell className="w-px border-r"><ActivePill active={l.isActive} /></TableCell>
                  <TableCell className="w-px text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="outline" size="sm" onClick={() => setValuesFor(l)}>
                        <List className="size-4" /> Values
                      </Button>
                      <Button variant="ghost" size="icon" className="size-8" title={`Edit ${l.code}`} onClick={() => openEdit(l)}>
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-muted-foreground hover:text-destructive disabled:opacity-40"
                        disabled={l.isSystem}
                        title={l.isSystem
                          ? 'Built-in list — the app reads it by key, so it cannot be deleted'
                          : `Delete ${l.code}`}
                        onClick={() => { if (confirm(`Delete ${l.code} and all its values?`)) deleteMutation.mutate(l.id); }}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {!isLoading && filtered.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="text-muted-foreground">
            Showing <span className="tabular-nums text-foreground">{start + 1}–{start + paged.length}</span> of{' '}
            <span className="tabular-nums text-foreground">{filtered.length}</span>
          </p>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Rows</span>
              <Select value={String(pageSize)} onValueChange={(v) => v && setPageSize(Number(v))}>
                <SelectTrigger className="h-8 w-20"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[10, 25, 50, 100].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="outline" size="icon" className="size-8" title="Previous page"
                disabled={current <= 1} onClick={() => setPage(current - 1)}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <span className="px-1 tabular-nums text-muted-foreground">Page {current} of {pageCount}</span>
              <Button
                variant="outline" size="icon" className="size-8" title="Next page"
                disabled={current >= pageCount} onClick={() => setPage(current + 1)}
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ---- create / edit the list itself ---- */}
      <Dialog open={formOpen} onOpenChange={(o) => { setFormOpen(o); if (!o) setEditing(null); }}>
        {/* Capped to the viewport with the fields scrolling inside, so the Save
            row is reachable on a short window instead of falling off-screen. */}
        <DialogContent className="flex max-h-[calc(100svh-2rem)] flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>{editing ? `Edit ${editing.code}` : 'New Option List'}</DialogTitle>
            <DialogDescription>
              {editing?.isSystem
                ? 'A built-in list: rename it and edit its values freely, but its code is fixed — the app reads it by key.'
                : 'The code is the key its values are stored under; the name is what admins read.'}
            </DialogDescription>
          </DialogHeader>
          {/* px-1/-mx-1 keeps focus rings from being clipped by the scroll box. */}
          <div className="-mx-1 min-h-0 flex-1 space-y-3 overflow-y-auto px-1">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-sm font-medium">Code</span>
                <Input
                  value={form.code}
                  disabled={!!editing?.isSystem}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                  placeholder="ASSET_TYPE"
                  className="font-mono"
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-sm font-medium">Name</span>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Asset Type" />
              </label>
            </div>
            {!editing && (
              <div className="space-y-1.5">
                <span className="text-sm font-medium">Module</span>
                <Select value={form.module} onValueChange={(v) => v && setForm({ ...form, module: v })}>
                  <SelectTrigger><SelectValue placeholder="Select a module" /></SelectTrigger>
                  <SelectContent>
                    {MODULES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Which screen area the list belongs to, and therefore where its values are
                  stored. It cannot be changed later.
                </p>
              </div>
            )}
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Description</span>
              <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Optional" />
            </label>
            <div className="divide-y rounded-lg border">
              <div className="flex items-center justify-between p-3">
                <div>
                  <p className="text-sm font-medium">Allow custom values</p>
                  <p className="text-xs text-muted-foreground">Recorded on the list; no screen enforces it yet.</p>
                </div>
                <Switch checked={form.allowCustom} onCheckedChange={(v) => setForm({ ...form, allowCustom: v })} />
              </div>
              <div className="flex items-center justify-between p-3">
                <div>
                  <p className="text-sm font-medium">Active</p>
                  <p className="text-xs text-muted-foreground">Marks a retired list on this screen.</p>
                </div>
                <Switch checked={form.isActive} onCheckedChange={(v) => setForm({ ...form, isActive: v })} />
              </div>
            </div>
          </div>
          <DialogFooter className="shrink-0">
            <Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button
              disabled={!form.code.trim() || !form.name.trim() || saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending ? 'Saving...' : editing ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- the values of one list ---- */}
      <ValuesDialog
        list={openList}
        onClose={() => setValuesFor(null)}
        onChanged={invalidate}
        onToggleList={(l) => toggleMutation.mutate(l)}
      />
    </div>
  );
}

const emptyValue = { code: '', description: '', parentValue: '', seq: '0' };

/** The Values dialog: add a value, reorder by seq, edit a row in place, delete. */
function ValuesDialog({ list, onClose, onChanged, onToggleList }: {
  list: OptionList | null;
  onClose: () => void;
  onChanged: () => void;
  onToggleList: (l: OptionList) => void;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<typeof emptyValue>(emptyValue);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState<typeof emptyValue>(emptyValue);

  const listId = list?.id;
  const { data: values = [], isLoading } = useQuery<OptionValue[]>({
    queryKey: ['option-list-values', listId],
    queryFn: async () => (await api.get(`/api/option-lists/${listId}/values`)).data,
    enabled: !!listId,
  });

  // Only fetched for a dependent list (sub-category -> category).
  const { data: parents = [] } = useQuery<OptionValue[]>({
    queryKey: ['option-list-parent-values', listId],
    queryFn: async () => (await api.get(`/api/option-lists/${listId}/parent-values`)).data,
    enabled: !!listId && !!list?.parentListKey,
  });
  const hasParent = !!list?.parentListKey;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['option-list-values', listId] });
    onChanged();
  };
  const fail = (e: any, fallback: string) => toast.error(e.response?.data?.message || fallback);

  const addMutation = useMutation({
    mutationFn: () => api.post(`/api/option-lists/${listId}/values`, {
      code: draft.code.trim(),
      description: draft.description.trim() || draft.code.trim(),
      parentValue: hasParent ? draft.parentValue || null : undefined,
      seq: Number(draft.seq) || 0,
    }),
    onSuccess: () => { refresh(); setDraft({ ...emptyValue, seq: draft.seq }); toast.success('Value added'); },
    onError: (e: any) => fail(e, 'Error adding value'),
  });

  const updateMutation = useMutation({
    mutationFn: (body: { id: string } & Record<string, unknown>) => {
      const { id, ...rest } = body;
      return api.patch(`/api/option-lists/${listId}/values/${id}`, rest);
    },
    onSuccess: () => { refresh(); setEditingId(null); },
    onError: (e: any) => fail(e, 'Error updating value'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/option-lists/${listId}/values/${id}`),
    onSuccess: () => { refresh(); toast.success('Value deleted'); },
    onError: (e: any) => fail(e, 'Error deleting value'),
  });

  const startEdit = (v: OptionValue) => {
    setEditingId(v.id);
    setEdit({
      code: v.code, description: v.description,
      parentValue: v.parentValue ?? '', seq: String(v.seq),
    });
  };

  const cols = hasParent ? 6 : 5;

  return (
    <Dialog open={!!list} onOpenChange={(o) => { if (!o) { setEditingId(null); setDraft(emptyValue); onClose(); } }}>
      <DialogContent className="flex max-h-[calc(100svh-2rem)] max-w-3xl flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>
            {list ? <>Values — <span className="font-mono">{list.code}</span> ({list.name})</> : 'Values'}
          </DialogTitle>
          <DialogDescription className="flex items-center gap-2">
            <span>{list?.sourceLabel}</span>
            {list && (
              <button
                type="button"
                onClick={() => onToggleList(list)}
                title="Toggle whether this list is active"
                className="cursor-pointer"
              >
                <ActivePill active={list.isActive} />
              </button>
            )}
            {hasParent && (
              <span className="flex items-center gap-1 text-xs">
                <CornerDownRight className="size-3.5" /> depends on {list?.parentListKey}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        {/* Add a value — the same fields the rows carry, so the form reads as a new row. */}
        <div className="flex shrink-0 flex-wrap items-end gap-2 border-b pb-4">
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Code</span>
            <Input value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} placeholder="e.g. High" className="w-40" />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Description</span>
            <Input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="Defaults to the code" className="w-56" />
          </label>
          {hasParent && (
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">Parent</span>
              <Select value={draft.parentValue} onValueChange={(v) => v && setDraft({ ...draft, parentValue: v })}>
                <SelectTrigger className="w-40"><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  {parents.map((p) => <SelectItem key={p.id} value={p.code}>{p.description || p.code}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
          )}
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Seq</span>
            <Input type="number" value={draft.seq} onChange={(e) => setDraft({ ...draft, seq: e.target.value })} className="w-20" />
          </label>
          <Button
            disabled={!draft.code.trim() || (hasParent && !draft.parentValue) || addMutation.isPending}
            onClick={() => addMutation.mutate()}
          >
            <Plus className="size-4" /> Add
          </Button>
        </div>

        {/* The only part that scrolls, so Add stays above it and Close below. */}
        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="border-r"><HeadLabel icon={ListOrdered}>Seq</HeadLabel></TableHead>
                <TableHead className="border-r"><HeadLabel icon={Hash}>Code</HeadLabel></TableHead>
                <TableHead className="w-full border-r"><HeadLabel icon={AlignLeft}>Description</HeadLabel></TableHead>
                {hasParent && <TableHead className="border-r"><HeadLabel icon={CornerDownRight}>Parent</HeadLabel></TableHead>}
                <TableHead className="border-r"><HeadLabel icon={CircleDot}>Active</HeadLabel></TableHead>
                <TableHead className="text-right text-xs font-semibold text-muted-foreground">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={cols} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>
              )}
              {!isLoading && values.length === 0 && (
                <TableRow><TableCell colSpan={cols} className="text-center text-muted-foreground">No values yet.</TableCell></TableRow>
              )}
              {values.map((v) => editingId === v.id ? (
                <TableRow key={v.id}>
                  <TableCell className="w-px border-r">
                    <Input type="number" value={edit.seq} onChange={(e) => setEdit({ ...edit, seq: e.target.value })} className="h-8 w-16" />
                  </TableCell>
                  <TableCell className="w-px border-r">
                    <Input value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value })} className="h-8 w-36" />
                  </TableCell>
                  <TableCell className="w-full border-r">
                    <Input value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} className="h-8" />
                  </TableCell>
                  {hasParent && (
                    <TableCell className="w-px border-r">
                      <Select value={edit.parentValue} onValueChange={(val) => val && setEdit({ ...edit, parentValue: val })}>
                        <SelectTrigger className="h-8 w-36"><SelectValue placeholder="Select…" /></SelectTrigger>
                        <SelectContent>
                          {parents.map((p) => <SelectItem key={p.id} value={p.code}>{p.description || p.code}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  )}
                  <TableCell className="w-px border-r"><ActivePill active={v.isActive} /></TableCell>
                  <TableCell className="w-px text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost" size="icon" className="size-8 text-emerald-600" title="Save"
                        disabled={!edit.code.trim() || updateMutation.isPending}
                        onClick={() => updateMutation.mutate({
                          id: v.id,
                          code: edit.code.trim(),
                          description: edit.description.trim(),
                          ...(hasParent ? { parentValue: edit.parentValue || null } : {}),
                          seq: Number(edit.seq) || 0,
                        })}
                      >
                        <Check className="size-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="size-8" title="Cancel" onClick={() => setEditingId(null)}>
                        <X className="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                <TableRow key={v.id}>
                  <TableCell className="w-px border-r tabular-nums text-muted-foreground">{v.seq}</TableCell>
                  <TableCell className="w-px border-r font-mono text-xs font-semibold text-primary">{v.code}</TableCell>
                  <TableCell className="w-full border-r">
                    <span className="block max-w-[20rem] truncate" title={v.description}>{v.description}</span>
                  </TableCell>
                  {hasParent && (
                    <TableCell className="w-px border-r text-muted-foreground">{v.parentValue || '—'}</TableCell>
                  )}
                  <TableCell className="w-px border-r">
                    {/* The value's own active flag — this one is live: dropdowns read it. */}
                    <button
                      type="button"
                      title={v.isActive ? 'Deactivate this value' : 'Activate this value'}
                      onClick={() => updateMutation.mutate({ id: v.id, isActive: !v.isActive })}
                      className="cursor-pointer"
                    >
                      <ActivePill active={v.isActive} />
                    </button>
                  </TableCell>
                  <TableCell className="w-px text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" className="size-8" title="Edit value" onClick={() => startEdit(v)}>
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-destructive"
                        title="Delete value"
                        onClick={() => { if (confirm(`Delete ${v.code}?`)) deleteMutation.mutate(v.id); }}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
