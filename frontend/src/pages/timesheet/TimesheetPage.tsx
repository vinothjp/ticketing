import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, ChevronLeft, ChevronRight, Upload, Save, Send, FileText, StickyNote } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Combobox } from '@/components/ui/combobox';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import {
  projectLabel, weekStartOf, addDays, dayHeader, statusVariant,
  type WeekResponse, type GridRow,
} from './timesheetMeta';

interface UserOption { id: string; username: string }

const emptyRow = (): GridRow => ({ projectId: '', taskId: null, activity: '', workPerformed: '', status: 'DRAFT', days: {} });
// The Activity box's value: the task, or — for an entry from before rows named a
// task — its old text, which stays shown (and saved) as it was.
const LEGACY = 'legacy:';
const activityValue = (r: GridRow) => r.taskId ?? (r.activity ? `${LEGACY}${r.activity}` : '');
const rowTotal = (r: GridRow) => Object.values(r.days).reduce((s, h) => s + (Number(h) || 0), 0);
// MM/DD/YY for the header date range (matches the reference layout).
const shortDate = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${String(d.getFullYear()).slice(2)}`;
};

export default function TimesheetPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isAdmin = !!user?.roles.includes('Admin');

  const [weekStart, setWeekStart] = useState(() => weekStartOf(new Date()));
  // An agent fills in their own week. An admin is not a consultant, so nobody is
  // preselected for them — they pick whose week to open, themselves included.
  const [consultantId, setConsultantId] = useState(isAdmin ? '' : user?.id ?? '');
  const noConsultant = !consultantId;
  const [rows, setRows] = useState<GridRow[]>([]);
  const [noteRow, setNoteRow] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery<WeekResponse>({
    queryKey: ['timesheet', 'week', consultantId, weekStart],
    enabled: !noConsultant,
    queryFn: async () =>
      (await api.get('/api/timesheet/week', { params: { weekStart, userId: consultantId || undefined } })).data,
    refetchOnWindowFocus: false,
  });

  const { data: users = [] } = useQuery<UserOption[]>({
    queryKey: ['users', 'timesheet-consultants'],
    enabled: isAdmin,
    queryFn: async () =>
      (await api.get('/api/users')).data.map((u: { id: string; username: string }) => ({ id: u.id, username: u.username })),
  });

  // Seed the editable grid from the server whenever the week/consultant loads or
  // is re-fetched (e.g. after a save). Padded to a few blank rows to type into.
  useEffect(() => {
    if (!data) return;
    const seeded: GridRow[] = data.rows.map((r) => ({ ...r, workPerformed: r.workPerformed ?? '' }));
    while (seeded.length < 4) seeded.push(emptyRow());
    setRows(seeded);
  }, [data]);

  const projects = data?.projects ?? [];
  const days = data?.days ?? [];
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const locked = (r: GridRow) => r.status === 'APPROVED';

  const setCell = (i: number, dayKey: string, value: string) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, days: { ...r.days, [dayKey]: value === '' ? 0 : Number(value) } } : r)));
  const setField = (i: number, patch: Partial<GridRow>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((prev) => [...prev, emptyRow()]);
  const removeRow = (i: number) => setRows((prev) => prev.filter((_, idx) => idx !== i));

  const dayTotal = (dayKey: string) => rows.reduce((s, r) => s + (Number(r.days[dayKey]) || 0), 0);
  const grandTotal = rows.reduce((s, r) => s + rowTotal(r), 0);

  const save = useMutation({
    mutationFn: (submit: boolean) => {
      const payload = rows
        .filter((r) => r.projectId && (r.taskId || r.activity))
        .map((r) => ({
          projectId: r.projectId,
          // The server stores the task's own title; only an old entry sends its text.
          ...(r.taskId ? { taskId: r.taskId } : { activity: r.activity }),
          workPerformed: r.workPerformed || undefined, days: r.days,
        }));
      return api.post('/api/timesheet/week', {
        weekStart, userId: consultantId || undefined, submit,
        documentNumber: data?.documentNumber, rows: payload,
      });
    },
    onSuccess: (_res, submit) => {
      qc.invalidateQueries({ queryKey: ['timesheet'] });
      qc.invalidateQueries({ queryKey: ['projects'] }); // per-project Timesheet tabs share the model
      toast.success(submit ? 'Timesheet submitted' : 'Timesheet saved');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error saving timesheet'),
  });

  const importFile = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      // Matched against the consultant's own projects, so the grid never holds one they can't save.
      return (await api.post('/api/timesheet/week/import', fd, { params: { userId: consultantId || undefined } })).data as { rows: GridRow[]; unmatched: string[] };
    },
    onSuccess: (res) => {
      // Merge imported rows into the grid, combining day hours for matching project+task.
      setRows((prev) => {
        const merged = [...prev.filter((r) => r.projectId && (r.taskId || r.activity))];
        for (const imp of res.rows) {
          const existing = merged.find((r) => r.projectId === imp.projectId && r.taskId === imp.taskId && !locked(r));
          if (existing) existing.days = { ...existing.days, ...imp.days };
          else merged.push({ projectId: imp.projectId, taskId: imp.taskId, activity: imp.activity, workPerformed: imp.workPerformed ?? '', status: 'DRAFT', days: imp.days });
        }
        while (merged.length < 4) merged.push(emptyRow());
        return merged;
      });
      const skipped = res.unmatched?.length ? ` · ${res.unmatched.length} unmatched skipped` : '';
      toast.success(`Imported ${res.rows.length} row(s)${skipped}`);
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Import failed'),
  });

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) importFile.mutate(file);
    e.target.value = '';
  };

  const consultantName = data?.consultant.username ?? user?.username ?? '';
  const weekEnd = weekStart ? addDays(weekStart, 6) : weekStart;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Timesheet</h1>
          <p className="text-sm text-muted-foreground">
            Owner <span className="font-medium text-foreground">{consultantName || '—'}</span>
            {' · '}{shortDate(weekStart)} to {shortDate(weekEnd)}
          </p>
          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <FileText className="size-3.5" /> {data?.documentNumber ?? '—'}
            <span className="mx-1">·</span> Document date {weekStart}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onPickFile} />
          <Button variant="outline" size="sm" disabled={noConsultant || importFile.isPending} onClick={() => fileRef.current?.click()}>
            <Upload className="size-4" /> Import
          </Button>
          <Button variant="outline" size="sm" disabled={noConsultant || save.isPending} onClick={() => save.mutate(false)}>
            <Save className="size-4" /> Save
          </Button>
          <Button size="sm" disabled={noConsultant || save.isPending} onClick={() => save.mutate(true)}>
            <Send className="size-4" /> Save &amp; Submit
          </Button>
        </div>
      </div>

      {/* Controls: consultant + week nav */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-y py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Consultant</span>
          {isAdmin ? (
            <Combobox
              size="sm" className="w-56" placeholder="Select consultant" emptyText="No matching user"
              value={consultantId}
              onChange={setConsultantId}
              options={[
                ...(user && !users.some((u) => u.id === user.id) ? [{ value: user.id, label: `${user.username} (me)` }] : []),
                ...users.map((u) => ({ value: u.id, label: u.id === user?.id ? `${u.username} (me)` : u.username })),
              ]}
            />
          ) : (
            <span className="text-sm font-medium">{consultantName}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" className="h-8" onClick={() => setWeekStart((w) => addDays(w, -7))}><ChevronLeft className="size-4" /></Button>
          <Button variant="outline" size="sm" className="h-8" onClick={() => setWeekStart(weekStartOf(new Date()))}>This week</Button>
          <Button variant="outline" size="sm" className="h-8" onClick={() => setWeekStart((w) => addDays(w, 7))}><ChevronRight className="size-4" /></Button>
        </div>
      </div>

      {noConsultant && (
        <p className="text-sm text-muted-foreground">Choose a consultant to open their timesheet for the week.</p>
      )}
      {!noConsultant && data && projects.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {consultantName || 'This consultant'} isn't on any project's Resources tab yet — time can only be logged on a project that lists them with a cost category.
        </p>
      )}

      {/* Grid */}
      {noConsultant ? null : isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <TooltipProvider delayDuration={0}>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left">
                <th className="min-w-[260px] px-3 py-2 font-medium">Client : Project</th>
                <th className="min-w-[240px] px-3 py-2 font-medium">Activity</th>
                {days.map((d, i) => {
                  const h = dayHeader(d, i);
                  const weekend = i >= 5;
                  return (
                    <th key={d} className={`w-16 px-2 py-2 text-center font-medium ${weekend ? 'text-muted-foreground' : ''}`}>
                      <div className="text-xs">{h.label}</div>
                      <div className="text-xs text-muted-foreground">{h.num}</div>
                    </th>
                  );
                })}
                <th className="w-20 px-3 py-2 text-right font-medium">Total</th>
                <th className="w-10 px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const isLocked = locked(r);
                return (
                  <tr key={i} className="border-b last:border-0">
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-1">
                        <Combobox
                          size="sm" className="min-w-0 flex-1" placeholder="Select project"
                          emptyText={projects.length ? 'No matching project' : 'No project associated'}
                          value={r.projectId}
                          onChange={(v) => { if (v !== r.projectId) setField(i, { projectId: v, taskId: null, activity: '' }); }}
                          disabled={isLocked}
                          options={projects.map((p) => ({ value: p.id, label: projectLabel(p) }))}
                        />
                        {r.status !== 'DRAFT' && <Badge variant={statusVariant(r.status)} className="shrink-0">{r.status}</Badge>}
                      </div>
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-1">
                        {(() => {
                          // The row's project's own tasks and subtasks, in WBS order.
                          const tasks = projectById.get(r.projectId)?.tasks ?? [];
                          return (
                            <Combobox
                              size="sm" className="min-w-0 flex-1" maxRows={5} placement="below"
                              placeholder={r.projectId ? 'Select task' : 'Select project first'}
                              emptyText={!r.projectId ? 'Pick a project first' : tasks.length ? 'No matching task' : 'No task on this project'}
                              value={activityValue(r)}
                              onChange={(v) => {
                                const t = tasks.find((x) => x.id === v);
                                if (t && t.id !== r.taskId) setField(i, { taskId: t.id, activity: t.title });
                              }}
                              disabled={isLocked || !r.projectId}
                              options={[
                                ...(!r.taskId && r.activity ? [{ value: activityValue(r), label: r.activity, hint: 'earlier entry' }] : []),
                                ...tasks.map((t) => ({ value: t.id, label: `${t.code} ${t.title}`, hint: t.phase })),
                              ]}
                            />
                          );
                        })()}
                        <Button variant="ghost" size="sm" className="h-8 px-2" title="Work performed" onClick={() => setNoteRow(i)}>
                          <StickyNote className={`size-4 ${r.workPerformed ? 'text-primary' : 'text-muted-foreground'}`} />
                        </Button>
                      </div>
                    </td>
                    {days.map((d) => {
                      const p = projectById.get(r.projectId);
                      const outside = !!p && ((!!p.startDate && d < p.startDate) || (!!p.endDate && d > p.endDate));
                      const cell = (
                        <Input
                          type="number" min={0} step="0.5" inputMode="decimal"
                          className="h-8 w-14 px-1 text-center tabular-nums"
                          value={r.days[d] ? String(r.days[d]) : ''}
                          // A day outside the project's run takes no hours; one already
                          // holding some stays editable so it can be cleared.
                          disabled={isLocked || (outside && !r.days[d])}
                          onChange={(e) => setCell(i, d, e.target.value)}
                        />
                      );
                      return (
                        <td key={d} className="px-1 py-1.5 text-center">
                          {outside ? (
                            // A disabled input fires no hover events, so the tooltip
                            // hangs off a wrapper — and shows at once, not after the
                            // browser's own title delay.
                            <Tooltip>
                              <TooltipTrigger asChild><span className="inline-block">{cell}</span></TooltipTrigger>
                              <TooltipContent>Outside the project's dates ({p?.startDate ?? '…'} to {p?.endDate ?? '…'})</TooltipContent>
                            </Tooltip>
                          ) : cell}
                        </td>
                      );
                    })}
                    <td className="px-3 py-1.5 text-right font-medium tabular-nums">{rowTotal(r) || ''}</td>
                    <td className="px-2 py-1.5 text-right">
                      <Button variant="ghost" size="sm" className="h-8 px-2 text-muted-foreground hover:text-destructive" disabled={isLocked} onClick={() => removeRow(i)}>
                        <Trash2 className="size-4" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t bg-muted/50 font-medium">
                <td className="px-3 py-2" colSpan={2}>
                  <Button variant="ghost" size="sm" className="h-7 px-2" onClick={addRow}><Plus className="size-4" /> Add row</Button>
                </td>
                {days.map((d) => (
                  <td key={d} className="px-2 py-2 text-center tabular-nums">{dayTotal(d) || ''}</td>
                ))}
                <td className="px-3 py-2 text-right tabular-nums">{grandTotal || 0}</td>
                <td />
              </tr>
            </tfoot>
          </table>
          </TooltipProvider>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Hours entered per day are saved as individual entries and shown in each project's Timesheet tab. Approved rows are locked.
      </p>

      {/* Work performed note dialog */}
      <Dialog open={noteRow !== null} onOpenChange={(o) => !o && setNoteRow(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Work performed
              {noteRow !== null && rows[noteRow]?.projectId && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {projectLabel(projectById.get(rows[noteRow].projectId))}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          {noteRow !== null && (
            <Textarea
              rows={5}
              placeholder="Describe the work performed…"
              value={rows[noteRow]?.workPerformed ?? ''}
              disabled={noteRow !== null && locked(rows[noteRow])}
              onChange={(e) => setField(noteRow, { workPerformed: e.target.value })}
            />
          )}
          <DialogFooter><Button onClick={() => setNoteRow(null)}>Done</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
