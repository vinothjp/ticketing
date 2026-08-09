import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Paperclip, Download } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DateField } from '@/components/ui/date-field';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { invalidateProject } from '../projectMeta';
import { useConfirm } from '@/hooks/useConfirm';
import Attachments from './Attachments';
import { exportCsv } from '../../../lib/exportCsv';
import { acceptAttr, uploadHint, MAX_UPLOAD_MB, splitAllowed } from '../../../lib/uploads';

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'success' | 'outline';

// Shared coloring for register status/severity words.
export function regBadge(v?: string | null): BadgeVariant {
  switch (v) {
    case 'HIGH': case 'URGENT': case 'REJECTED': case 'MISSED': return 'destructive';
    case 'APPROVED': case 'MET': case 'RESOLVED': case 'CLOSED': case 'MITIGATED': case 'Paid': return 'success';
    case 'IN_PROGRESS': return 'default';
    case 'MEDIUM': case 'PENDING': case 'OPEN': case 'SUBMITTED': case 'Pending': return 'secondary';
    default: return 'outline';
  }
}

export type FieldCfg = { key: string; label: string; type: 'text' | 'textarea' | 'number' | 'date' | 'select'; options?: string[]; };
// `compute` derives the cell value from the whole row (e.g. an invoice's Pending/Paid status).
export type ColCfg = { key: string; label: string; kind?: 'badge' | 'date' | 'money' | 'text' | 'link'; align?: 'right'; compute?: (row: Record<string, any>) => any };

const toDateInput = (v?: string | null) => (v ? new Date(v).toISOString().slice(0, 10) : '');
const money = (n: unknown) => (n == null ? '—' : Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 }));

export default function RegisterSection({
  projectId, type, singular, fields, columns, attachEntityType, acceptTypes, exportable, summaryRows, validate,
}: {
  projectId: string;
  type: string;
  singular: string;
  fields: FieldCfg[];
  columns: ColCfg[];
  attachEntityType?: string;   // when set, each row gets an attachments (upload/link) dialog
  acceptTypes?: string[];      // allowed file extensions for this submodule (from Settings)
  exportable?: boolean;        // when set, show an "Export CSV" button
  // Read-only summary panel computed from the live form (e.g. invoice amount / paid / balance / status).
  summaryRows?: { rows: { label: string; value?: (form: Record<string, any>) => number; badge?: (form: Record<string, any>) => string; emphasis?: boolean }[]; currency?: string };
  // Returns an error message to show + disable Save when the form is invalid.
  validate?: (form: Record<string, any>) => string | null;
}) {
  const qc = useQueryClient();
  const { confirm, ConfirmDialog } = useConfirm();
  const [open, setOpen] = useState(false);
  // Attachments staged in the Add dialog (a new row has no id yet); uploaded after create.
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [stagedLinks, setStagedLinks] = useState<string[]>([]);
  const [stagedLink, setStagedLink] = useState('');
  const stageFileRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<Record<string, any> | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});
  const key = ['projects', projectId, 'registers', type];
  const invalidate = () => invalidateProject(qc);

  const { data: items = [], isLoading } = useQuery<Record<string, any>[]>({
    queryKey: key,
    queryFn: async () => (await api.get(`/api/projects/${projectId}/registers/${type}`)).data,
  });

  // Optional read-only summary panel + validation (e.g. invoice amount / paid / balance).
  const sCur = summaryRows?.currency ? `${summaryRows.currency} ` : '';
  const sMoney = (n: number) => `${sCur}${Math.round(n).toLocaleString()}`;
  const validationError = validate ? validate(form) : null;

  useEffect(() => {
    if (!open) return;
    const init: Record<string, any> = {};
    for (const f of fields) init[f.key] = editing ? (f.type === 'date' ? toDateInput(editing[f.key]) : editing[f.key] ?? '') : (f.type === 'select' ? (f.options?.[0] ?? '') : '');
    setForm(init);
    setStagedFiles([]); setStagedLinks([]); setStagedLink('');
  }, [open, editing, fields]);

  const save = useMutation({
    mutationFn: async () => {
      if (editing) return (await api.patch(`/api/projects/registers/${type}/${editing.id}`, form)).data;
      const created = (await api.post(`/api/projects/${projectId}/registers/${type}`, form)).data;
      // Upload any attachments staged in the Add dialog to the freshly-created row.
      if (attachEntityType && created?.id) {
        if (stagedFiles.length) {
          const fd = new FormData();
          fd.append('entityType', attachEntityType);
          fd.append('entityId', created.id);
          stagedFiles.forEach((f) => fd.append('attachments', f));
          await api.post(`/api/projects/${projectId}/attachments/upload`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        }
        for (const url of stagedLinks) {
          await api.post(`/api/projects/${projectId}/attachments/link`, { entityType: attachEntityType, entityId: created.id, url });
        }
      }
      return created;
    },
    onSuccess: () => { invalidate(); setOpen(false); setEditing(null); toast.success('Saved'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error saving'),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/api/projects/registers/${type}/${id}`),
    onSuccess: () => { invalidate(); toast.success('Deleted'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  });

  const cell = (row: Record<string, any>, c: ColCfg) => {
    const v = c.compute ? c.compute(row) : row[c.key];
    if (c.kind === 'badge') return v ? <Badge variant={regBadge(v)}>{String(v).replace('_', ' ')}</Badge> : '—';
    if (c.kind === 'date') return v ? new Date(v).toLocaleDateString() : '—';
    if (c.kind === 'money') return money(v);
    if (c.kind === 'link') return v ? <a href={String(v)} target="_blank" rel="noreferrer" className="text-primary hover:underline">Open</a> : '—';
    return v ?? '—';
  };

  // Raw (non-JSX) value for CSV export.
  const csvValue = (row: Record<string, any>, c: ColCfg) => {
    const v = c.compute ? c.compute(row) : row[c.key];
    if (v == null) return '';
    if (c.kind === 'date') return new Date(v).toLocaleDateString();
    return v;
  };
  const doExport = () => exportCsv(`${type}`, items, columns.map((c) => ({ header: c.label, value: (row: Record<string, any>) => csvValue(row, c) })));

  return (
    <div className="space-y-3">
      {ConfirmDialog}
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{items.length} {singular.toLowerCase()}{items.length === 1 ? '' : 's'}</span>
        <div className="flex gap-2">
          {exportable && <Button size="sm" variant="outline" disabled={items.length === 0} onClick={doExport}><Download className="size-4" /> Export CSV</Button>}
          <Button size="sm" onClick={() => { setEditing(null); setOpen(true); }}><Plus className="size-4" /> Add {singular}</Button>
        </div>
      </div>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
        <DialogContent className="flex max-h-[85vh] flex-col">
          <DialogHeader><DialogTitle>{editing ? `Edit ${singular}` : `Add ${singular}`}</DialogTitle></DialogHeader>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            {fields.map((f) => (
              <div key={f.key}>
                <div className="mb-1 text-sm">{f.label}</div>
                {f.type === 'textarea' ? (
                  <Textarea rows={2} value={form[f.key] ?? ''} onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))} />
                ) : f.type === 'select' ? (
                  <Select value={form[f.key] || (f.options?.[0] ?? '')} onValueChange={(v) => setForm((s) => ({ ...s, [f.key]: v }))}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>{(f.options ?? []).map((o) => <SelectItem key={o} value={o}>{o.replace('_', ' ')}</SelectItem>)}</SelectContent>
                  </Select>
                ) : f.type === 'date' ? (
                  <DateField value={form[f.key] ?? ''} onChange={(v) => setForm((s) => ({ ...s, [f.key]: v }))} />
                ) : (
                  <Input type={f.type === 'number' ? 'number' : 'text'}
                    value={form[f.key] ?? ''} onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))} />
                )}
              </div>
            ))}

            {summaryRows && (
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                {summaryRows.rows.map((r, i) => (
                  <div key={r.label} className={`flex items-center justify-between ${i > 0 ? 'mt-1' : ''} ${r.emphasis ? 'border-t pt-1 font-medium' : ''}`}>
                    <span className={r.emphasis ? '' : 'text-muted-foreground'}>{r.label}</span>
                    {r.badge
                      ? <Badge variant={regBadge(r.badge(form))}>{r.badge(form)}</Badge>
                      : <span className="tabular-nums">{sMoney(r.value ? r.value(form) : 0)}</span>}
                  </div>
                ))}
                {validationError && <p className="mt-1 text-xs font-medium text-destructive">{validationError}</p>}
              </div>
            )}

            {attachEntityType && (
              <div className="border-t pt-3">
                <div className="mb-1.5 text-sm font-medium">Attachments</div>
                {editing ? (
                  // Existing row → attach immediately.
                  <Attachments projectId={projectId} entityType={attachEntityType} entityId={editing.id} acceptTypes={acceptTypes} />
                ) : (
                  // New row → stage files/links; uploaded after Save.
                  <div className="space-y-2">
                    {(stagedFiles.length > 0 || stagedLinks.length > 0) && (
                      <ul className="space-y-1 text-sm">
                        {stagedFiles.map((f, i) => (
                          <li key={`f${i}`} className="flex items-center gap-2">
                            <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
                            <span className="flex-1 truncate">{f.name}</span>
                            <button type="button" className="text-muted-foreground hover:text-destructive" onClick={() => setStagedFiles((s) => s.filter((_, idx) => idx !== i))}><Trash2 className="size-3.5" /></button>
                          </li>
                        ))}
                        {stagedLinks.map((u, i) => (
                          <li key={`l${i}`} className="flex items-center gap-2">
                            <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
                            <span className="flex-1 truncate">{u}</span>
                            <button type="button" className="text-muted-foreground hover:text-destructive" onClick={() => setStagedLinks((s) => s.filter((_, idx) => idx !== i))}><Trash2 className="size-3.5" /></button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      <input ref={stageFileRef} type="file" multiple accept={acceptAttr(acceptTypes)} className="hidden"
                        onChange={(e) => {
                          // Capture the files synchronously — reading e.target.files inside the
                          // async state updater would see an empty list (value is cleared below).
                          const picked = e.target.files ? Array.from(e.target.files) : [];
                          e.target.value = '';
                          const { ok, tooBig, badType } = splitAllowed(picked, acceptTypes);
                          if (badType.length) toast.error(`${badType.length === 1 ? 'File type is' : 'Some file types are'} not allowed here`);
                          if (tooBig.length) toast.error(`${tooBig.length === 1 ? 'File is' : 'Some files are'} over ${MAX_UPLOAD_MB} MB and were skipped`);
                          if (ok.length) setStagedFiles((s) => [...s, ...ok]);
                        }} />
                      <Button type="button" size="sm" variant="outline" onClick={() => stageFileRef.current?.click()}><Paperclip className="size-3.5" /> Attach file</Button>
                      <div className="flex items-center gap-1">
                        <Input className="h-8 w-44" placeholder="Paste a link…" value={stagedLink}
                          onChange={(e) => setStagedLink(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter' && stagedLink.trim()) { setStagedLinks((s) => [...s, stagedLink.trim()]); setStagedLink(''); } }} />
                        <Button type="button" size="sm" variant="outline" disabled={!stagedLink.trim()} onClick={() => { setStagedLinks((s) => [...s, stagedLink.trim()]); setStagedLink(''); }}>Add</Button>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">{uploadHint(acceptTypes)}</p>
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter><Button disabled={save.isPending || !!validationError} onClick={() => save.mutate()}>{save.isPending ? 'Saving...' : 'Save'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((c) => <TableHead key={c.key} className={c.align === 'right' ? 'text-right' : ''}>{c.label}</TableHead>)}
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={columns.length + 1} className="text-center text-muted-foreground">Loading...</TableCell></TableRow>}
            {!isLoading && items.length === 0 && <TableRow><TableCell colSpan={columns.length + 1} className="text-center text-muted-foreground">No {singular.toLowerCase()}s yet.</TableCell></TableRow>}
            {items.map((row) => (
              <TableRow key={row.id}>
                {columns.map((c) => <TableCell key={c.key} className={c.align === 'right' ? 'text-right tabular-nums' : c.key === columns[0].key ? 'font-medium' : ''}>{cell(row, c)}</TableCell>)}
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={() => { setEditing(row); setOpen(true); }}><Pencil className="size-4" /></Button>
                    <Button size="sm" variant="destructive" onClick={async () => { if (await confirm({ title: `Delete this ${singular.toLowerCase()}?`, destructive: true, confirmText: 'Delete' })) del.mutate(row.id); }}><Trash2 className="size-4" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
