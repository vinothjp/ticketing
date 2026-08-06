import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Pencil, Trash2, Flag, List, LayoutGrid, CalendarRange, Layers, ListTree, FolderPlus } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../../lib/api';
import { useAuth } from '../../../context/AuthContext';
import { useConfirm, usePrompt } from '@/hooks/useConfirm';
import { Button } from '@/components/ui/button';
import { DateField } from '@/components/ui/date-field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import {
  TASK_STATUSES, WBS_TYPES, PRIORITIES, invalidateProject, labelOf, taskStatusVariant, priorityVariant, taskKey,
  type ProjectDetail, type ProjectTask, type UserOption,
} from '../projectMeta';
import TaskBoard from './TaskBoard';
import TaskGantt from './TaskGantt';
import TaskDetailDialog from './TaskDetailDialog';
import WbsView from './WbsView';
import PriorityMark from './PriorityMark';

const NONE = '__none__';

const taskSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  wbsType: z.enum(WBS_TYPES),
  milestoneId: z.string().optional(),
  sprintId: z.string().optional(),
  parentTaskId: z.string().optional(),
  description: z.string().optional(),
  assigneeUserId: z.string().optional(),
  status: z.enum(TASK_STATUSES),
  priority: z.string().optional(),
  startDate: z.string().min(1, 'Start date is required'),
  dueDate: z.string().min(1, 'End date is required'),
  durationDays: z.string().optional(),
  completionPct: z.string().optional(),
  estimatedHours: z.string().optional(),
  position: z.string().optional(),   // 1-based insert position among siblings (create only)
});
type TaskValues = z.infer<typeof taskSchema>;

const emptyTask = (): TaskValues => ({
  title: '', wbsType: 'TASK', milestoneId: '', sprintId: '', parentTaskId: '', description: '',
  assigneeUserId: '', status: 'TODO', priority: '', startDate: '', dueDate: '', durationDays: '', completionPct: '', estimatedHours: '', position: '',
});
const toDateInput = (v?: string | null) => (v ? new Date(v).toISOString().slice(0, 10) : '');
const nextLevel = (t: string) =>
  t === 'PHASE' ? 'TASK' : t === 'TASK' ? 'SUBTASK' : t === 'SUBTASK' ? 'ACTIVITY' : 'ACTIVITY';

type View = 'wbs' | 'list' | 'group' | 'board' | 'timeline';

export default function TasksTab({ project, users }: { project: ProjectDetail; users: UserOption[] }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = !!user?.roles.includes('Admin');
  const myId = user?.id ?? null;
  // Agents may only edit tasks assigned to them; admins edit anything.
  const canEdit = (t: ProjectTask) => isAdmin || t.assigneeUserId === myId;
  // For the Gantt, agents see only their assigned tasks (plus ancestors to keep the WBS tree intact).
  const ganttProject = useMemo(() => {
    if (isAdmin) return project;
    const byId = new Map(project.tasks.map((t) => [t.id, t]));
    const keep = new Set<string>();
    for (const t of project.tasks) if (t.assigneeUserId === myId) {
      let cur: ProjectTask | undefined = t;
      while (cur) { keep.add(cur.id); cur = cur.parentTaskId ? byId.get(cur.parentTaskId) : undefined; }
    }
    return { ...project, tasks: project.tasks.filter((t) => keep.has(t.id)) };
  }, [project, isAdmin, myId]);
  const { confirm, ConfirmDialog } = useConfirm();
  const { prompt, PromptDialog } = usePrompt();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectTask | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [view, setView] = useState<View>('wbs');
  const invalidate = () => invalidateProject(qc);

  const form = useForm<TaskValues>({ resolver: zodResolver(taskSchema), defaultValues: emptyTask() });

  // Auto-calc: Duration (days) = Due − Start; Est. hours = Duration × 9 (9h working day).
  const wStart = form.watch('startDate');
  const wDue = form.watch('dueDate');
  const wParentId = form.watch('parentTaskId');
  // Constrain the date pickers to (parent window ∩ project window): a child can't start
  // before or end after its parent — activity ⊂ sub-task ⊂ task ⊂ phase ⊂ project.
  const parentSel = project.tasks.find((t) => t.id === wParentId);
  const parentStart = parentSel?.startDate ? toDateInput(parentSel.startDate) : undefined;
  const parentEnd = parentSel?.dueDate ? toDateInput(parentSel.dueDate) : undefined;
  const projMin = toDateInput(project.startDate);
  const latest = (...ds: (string | undefined)[]) => ds.filter(Boolean).sort().slice(-1)[0] as string | undefined;
  const earliest = (...ds: (string | undefined)[]) => ds.filter(Boolean).sort()[0] as string | undefined;
  const dateFloor = latest(parentStart, projMin);
  // Cap a child by its parent's end; a top-level phase is uncapped so it can extend the project.
  const dateCap = parentEnd;
  const wDur = form.watch('durationDays');
  useEffect(() => {
    if (wStart && wDue) {
      const d = Math.max(0, Math.round((new Date(wDue).getTime() - new Date(wStart).getTime()) / 86400000));
      if (String(d) !== (form.getValues('durationDays') || '')) form.setValue('durationDays', String(d));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wStart, wDue]);
  useEffect(() => {
    const d = wDur ? Number(wDur) : 0;
    const est = d ? String(d * 9) : '';
    if (est !== (form.getValues('estimatedHours') || '')) form.setValue('estimatedHours', est);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wDur]);

  useEffect(() => {
    if (!dialogOpen) return;
    if (editing) {
      form.reset({
        title: editing.title,
        wbsType: (editing.wbsType as TaskValues['wbsType']) ?? 'TASK',
        milestoneId: editing.milestoneId ?? '',
        sprintId: editing.sprintId ?? '',
        parentTaskId: editing.parentTaskId ?? '',
        description: editing.description ?? '',
        assigneeUserId: editing.assigneeUserId ?? '',
        status: (editing.status as TaskValues['status']) ?? 'TODO',
        priority: editing.priority ?? '',
        startDate: toDateInput(editing.startDate),
        dueDate: toDateInput(editing.dueDate),
        durationDays: editing.durationDays != null ? String(editing.durationDays) : '',
        completionPct: editing.completionPct != null ? String(editing.completionPct) : '',
        estimatedHours: editing.estimatedHours != null ? String(editing.estimatedHours) : '',
      });
    }
  }, [dialogOpen, editing, form]);

  const buildPayload = (v: TaskValues) => {
    const start = v.startDate || undefined;
    let dur = v.durationDays ? Number(v.durationDays) : undefined;
    // An explicit due date wins; duration is derived from start→due to stay consistent.
    // Otherwise fall back to computing due from start + duration.
    let due: string | undefined;
    if (v.dueDate) {
      due = v.dueDate;
      if (start) dur = Math.max(0, Math.round((new Date(v.dueDate).getTime() - new Date(start).getTime()) / 86400000));
    } else if (start && dur != null) {
      due = new Date(new Date(start).getTime() + dur * 86400000).toISOString().slice(0, 10);
    }
    return {
      title: v.title,
      wbsType: v.wbsType,
      type: v.wbsType === 'MILESTONE' ? 'MILESTONE' : 'TASK',
      milestoneId: v.milestoneId || null,
      sprintId: v.sprintId || null,
      parentTaskId: v.parentTaskId || null,
      description: v.description || undefined,
      assigneeUserId: v.assigneeUserId || undefined,
      status: v.status,
      priority: v.priority || undefined,
      startDate: start,
      dueDate: due,
      durationDays: dur,
      completionPct: v.completionPct ? Number(v.completionPct) : undefined,
      estimatedHours: v.estimatedHours ? Number(v.estimatedHours) : undefined,
    };
  };

  const saveMutation = useMutation({
    mutationFn: (v: TaskValues) => editing
      ? api.patch(`/api/projects/tasks/${editing.id}`, buildPayload(v))
      // On create, an explicit 1-based position inserts at that slot (backend shifts the rest).
      : api.post(`/api/projects/${project.id}/tasks`, { ...buildPayload(v), ...(v.position ? { sortOrder: Math.max(0, Number(v.position) - 1) } : {}) }),
    onSuccess: () => { invalidate(); setDialogOpen(false); setEditing(null); toast.success(editing ? 'Saved' : 'Added'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error saving'),
  });
  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.patch(`/api/projects/tasks/${id}/status`, { status }),
    onSuccess: invalidate,
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error updating status'),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/projects/tasks/${id}`),
    onSuccess: () => { invalidate(); toast.success('Deleted'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error deleting'),
  });
  const moveMutation = useMutation({
    mutationFn: (v: { id: string; direction: 'up' | 'down' }) => api.patch(`/api/projects/tasks/${v.id}/move`, { direction: v.direction }),
    onSuccess: invalidate,
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error moving'),
  });
  const createMilestone = useMutation({
    mutationFn: (name: string) => api.post(`/api/projects/${project.id}/milestones`, { name }),
    onSuccess: () => { invalidate(); toast.success('Milestone added'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error adding milestone'),
  });
  const deleteMilestone = useMutation({
    mutationFn: (id: string) => api.delete(`/api/projects/milestones/${id}`),
    onSuccess: () => { invalidate(); toast.success('Milestone deleted'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  });

  // Open the add dialog, optionally as a child of `parent`.
  // Default Start for a new item: the day after the previous sibling ends; for the first
  // child of a parent, the parent's own start; for the first top-level item, blank.
  const plusDays = (v: string, n: number) => new Date(new Date(v).getTime() + n * 86400000).toISOString().slice(0, 10);
  const endOf = (t: ProjectTask) => t.dueDate;
  const autoStartFor = (parent?: ProjectTask | null) => {
    const siblings = project.tasks.filter((t) => (t.parentTaskId ?? null) === (parent?.id ?? null));
    if (siblings.length) {
      const last = siblings.reduce((a, b) => ((a.sortOrder ?? 0) >= (b.sortOrder ?? 0) ? a : b));
      const e = endOf(last);
      return e ? plusDays(e, 1) : '';
    }
    if (parent?.startDate) return toDateInput(parent.startDate);
    return toDateInput(project.startDate); // top-level: default to the project start
  };
  // Default Start (chained) + a 2-day End, clamped into the parent's window so the prefill
  // never violates the calendar bounds (extend the parent to make more room).
  const defaultDates = (parent?: ProjectTask | null) => {
    const pStart = parent?.startDate ? toDateInput(parent.startDate) : undefined;
    const pEnd = parent?.dueDate ? toDateInput(parent.dueDate) : undefined;
    const floor = latest(pStart, projMin);
    let s = autoStartFor(parent);
    if (floor && s && s < floor) s = floor;
    if (pEnd && s && s > pEnd) s = pEnd;
    let e = s ? plusDays(s, 2) : '';
    if (pEnd && e && e > pEnd) e = pEnd;
    return { s, e };
  };

  // When creating, changing the Parent re-chains the default Start + End into that parent's window.
  useEffect(() => {
    if (editing || !dialogOpen) return;
    const { s, e } = defaultDates(project.tasks.find((t) => t.id === wParentId) ?? null);
    form.setValue('startDate', s);
    form.setValue('dueDate', e);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wParentId]);

  const openCreate = (parent?: ProjectTask | null) => {
    setEditing(null);
    const { s, e } = defaultDates(parent);
    form.reset({
      ...emptyTask(),
      parentTaskId: parent?.id ?? '',
      startDate: s,
      dueDate: e,
      milestoneId: parent?.milestoneId ?? '',
      wbsType: parent ? nextLevel(parent.wbsType) : 'PHASE',
    });
    setDialogOpen(true);
  };
  const openEdit = (t: ProjectTask) => setDetailId(t.id);
  const addMilestone = async () => {
    const n = await prompt({ title: 'New milestone', label: 'Milestone name', placeholder: 'e.g. Design phase', required: true, confirmText: 'Create' });
    if (n?.trim()) createMilestone.mutate(n.trim());
  };

  const groups = useMemo(() => {
    const byM = new Map<string, ProjectTask[]>();
    for (const t of project.tasks) {
      const k = t.milestoneId ?? NONE;
      (byM.get(k) ?? byM.set(k, []).get(k)!).push(t);
    }
    const out: { id: string | null; name: string; tasks: ProjectTask[] }[] = project.milestones.map((m) => ({
      id: m.id, name: m.name, tasks: byM.get(m.id) ?? [],
    }));
    const un = byM.get(NONE) ?? [];
    if (un.length) out.push({ id: null, name: 'Unassigned', tasks: un });
    return out.filter((g) => g.tasks.length > 0 || g.id);
  }, [project.tasks, project.milestones]);

  const ToggleBtn = ({ v, icon: Icon, label }: { v: View; icon: typeof List; label: string }) => (
    <Button size="sm" variant={view === v ? 'secondary' : 'ghost'} className="h-7 px-2" onClick={() => setView(v)}>
      <Icon className="size-4" /> {label}
    </Button>
  );

  const TaskRows = ({ tasks }: { tasks: ProjectTask[] }) => (
    <>
      {tasks.map((t) => {
        const end = t.isParent ? t.rolledEnd : t.dueDate;
        const done = ((t.isParent ? t.rolledCompletionPct : t.completionPct) ?? 0) >= 100;
        const overdue = !done && !!end && new Date(end).getTime() < Date.now();
        return (
        <TableRow key={t.id} className={overdue ? 'border-l-2 border-l-destructive bg-destructive/5 hover:bg-destructive/10' : undefined}>
          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{taskKey(project.key, t.taskNumber) || '—'}</TableCell>
          <TableCell className="font-medium">
            <button type="button" onClick={() => openEdit(t)} className="flex items-center gap-1.5 text-left hover:underline">
              {t.wbsType === 'MILESTONE' && <Flag className="size-3.5 text-primary" />}
              <PriorityMark priority={t.priority} />{t.title}
              {overdue && <Badge variant="destructive" className="ml-1">Overdue</Badge>}
            </button>
          </TableCell>
          <TableCell className="text-right text-sm tabular-nums">{(t.isParent ? t.rolledDurationDays : t.durationDays) ?? '—'}{(t.isParent ? t.rolledDurationDays : t.durationDays) != null ? 'd' : ''}</TableCell>
          <TableCell>{t.assigneeName || <span className="text-muted-foreground">—</span>}</TableCell>
          <TableCell>{t.priority ? <Badge variant={priorityVariant(t.priority)}>{labelOf(t.priority)}</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>
          <TableCell className="text-xs text-muted-foreground">{(t.isParent ? t.rolledCompletionPct : t.completionPct) ?? 0}%</TableCell>
          <TableCell>
            {canEdit(t) ? (
              <Select value={t.status} onValueChange={(v) => statusMutation.mutate({ id: t.id, status: v })}>
                <SelectTrigger size="sm" className="w-36"><Badge variant={taskStatusVariant(t.status)}>{labelOf(t.status)}</Badge></SelectTrigger>
                <SelectContent>{TASK_STATUSES.map((s) => <SelectItem key={s} value={s}>{labelOf(s)}</SelectItem>)}</SelectContent>
              </Select>
            ) : <Badge variant={taskStatusVariant(t.status)}>{labelOf(t.status)}</Badge>}
          </TableCell>
          <TableCell className="text-right">
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => openEdit(t)}><Pencil className="size-4" /></Button>
              {canEdit(t) && <Button size="sm" variant="destructive" onClick={async () => { if (await confirm({ title: 'Delete task?', destructive: true, confirmText: 'Delete' })) deleteMutation.mutate(t.id); }}><Trash2 className="size-4" /></Button>}
            </div>
          </TableCell>
        </TableRow>
        );
      })}
    </>
  );

  const HeaderRow = () => (
    <TableRow>
      <TableHead className="w-20">Key</TableHead>
      <TableHead>Title</TableHead>
      <TableHead className="text-right">Days</TableHead>
      <TableHead>Assignee</TableHead>
      <TableHead>Priority</TableHead>
      <TableHead>%</TableHead>
      <TableHead>Status</TableHead>
      <TableHead className="text-right">Actions</TableHead>
    </TableRow>
  );

  return (
    <div className="space-y-4">
      {ConfirmDialog}
      {PromptDialog}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground">
          {project.tasks.length} WBS item{project.tasks.length === 1 ? '' : 's'} · {project.milestones.length} milestone{project.milestones.length === 1 ? '' : 's'}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border p-0.5">
            <ToggleBtn v="wbs" icon={ListTree} label="WBS" />
            <ToggleBtn v="list" icon={List} label="List" />
            <ToggleBtn v="group" icon={Layers} label="Milestones" />
            <ToggleBtn v="board" icon={LayoutGrid} label="Board" />
            <ToggleBtn v="timeline" icon={CalendarRange} label="Gantt" />
          </div>
          {isAdmin && <Button size="sm" variant="outline" onClick={addMilestone}><FolderPlus className="size-4" /> New Milestone</Button>}
          {isAdmin && <Button size="sm" onClick={() => openCreate(null)}><Plus className="size-4" /> Add Item</Button>}
        </div>
      </div>

      <TaskDetailDialog
        taskId={detailId} projectId={project.id} projectKey={project.key ?? null}
        users={users} tasks={project.tasks} projectStart={projMin} onClose={() => setDetailId(null)}
      />

      <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) setEditing(null); }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? 'Edit WBS item' : 'Add WBS item'}</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => saveMutation.mutate(v))} className="space-y-3">
              <FormField control={form.control} name="title" render={({ field }) => (
                <FormItem><FormLabel>Title</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="wbsType" render={({ field }) => (
                  <FormItem><FormLabel>WBS level</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger className="w-full"><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>{WBS_TYPES.map((t) => <SelectItem key={t} value={t}>{labelOf(t)}</SelectItem>)}</SelectContent>
                    </Select>
                  </FormItem>
                )} />
                <FormField control={form.control} name="parentTaskId" render={({ field }) => (
                  <FormItem><FormLabel>Parent (WBS)</FormLabel>
                    <Select value={field.value || NONE} onValueChange={(v) => field.onChange(v === NONE ? '' : v)}>
                      <FormControl><SelectTrigger className="w-full"><SelectValue placeholder="None (top level)" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value={NONE}>None (top level)</SelectItem>
                        {project.tasks.filter((t) => t.id !== editing?.id).map((t) => (
                          <SelectItem key={t.id} value={t.id}>{t.wbsCode} · {t.title}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
              </div>
              {!editing && (
                <FormField control={form.control} name="position" render={({ field }) => (
                  <FormItem><FormLabel>Position (optional)</FormLabel>
                    <FormControl><Input type="number" min={1} placeholder="Leave blank to add at the end" {...field} /></FormControl>
                    <p className="text-xs text-muted-foreground">e.g. 4 inserts as the 4th item under its parent; existing items from 4 onward shift down.</p>
                  </FormItem>
                )} />
              )}
              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="milestoneId" render={({ field }) => (
                  <FormItem><FormLabel>Milestone</FormLabel>
                    <Select value={field.value || NONE} onValueChange={(v) => field.onChange(v === NONE ? '' : v)}>
                      <FormControl><SelectTrigger className="w-full"><SelectValue placeholder="Unassigned" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value={NONE}>Unassigned</SelectItem>
                        {project.milestones.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
                <FormField control={form.control} name="sprintId" render={({ field }) => (
                  <FormItem><FormLabel>Sprint</FormLabel>
                    <Select value={field.value || NONE} onValueChange={(v) => field.onChange(v === NONE ? '' : v)}>
                      <FormControl><SelectTrigger className="w-full"><SelectValue placeholder="Backlog" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value={NONE}>Backlog</SelectItem>
                        {project.sprints.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="assigneeUserId" render={({ field }) => (
                  <FormItem><FormLabel>Assignee</FormLabel>
                    <Select value={field.value || NONE} onValueChange={(v) => field.onChange(v === NONE ? '' : v)}>
                      <FormControl><SelectTrigger className="w-full"><SelectValue placeholder="Unassigned" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value={NONE}>Unassigned</SelectItem>
                        {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.username}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
                <FormField control={form.control} name="status" render={({ field }) => (
                  <FormItem><FormLabel>Status</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger className="w-full"><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>{TASK_STATUSES.map((s) => <SelectItem key={s} value={s}>{labelOf(s)}</SelectItem>)}</SelectContent>
                    </Select>
                  </FormItem>
                )} />
              </div>
              <div className="grid grid-cols-4 gap-3">
                <FormField control={form.control} name="startDate" render={({ field }) => (
                  <FormItem><FormLabel>Start *</FormLabel><FormControl><DateField value={field.value} onChange={field.onChange} min={dateFloor} max={earliest(wDue, dateCap)} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="dueDate" render={({ field }) => (
                  <FormItem><FormLabel>End *</FormLabel><FormControl><DateField value={field.value} onChange={field.onChange} min={latest(wStart, dateFloor)} max={dateCap} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="durationDays" render={({ field }) => (
                  <FormItem><FormLabel>Duration (d)</FormLabel><FormControl><Input type="number" min={0} {...field} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="completionPct" render={({ field }) => (
                  <FormItem><FormLabel>%</FormLabel><FormControl><Input type="number" min={0} max={100} {...field} /></FormControl></FormItem>
                )} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="priority" render={({ field }) => (
                  <FormItem><FormLabel>Priority</FormLabel>
                    <Select value={field.value || NONE} onValueChange={(v) => field.onChange(v === NONE ? '' : v)}>
                      <FormControl><SelectTrigger className="w-full"><SelectValue placeholder="None" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value={NONE}>None</SelectItem>
                        {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{labelOf(p)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
                <FormField control={form.control} name="estimatedHours" render={({ field }) => (
                  <FormItem><FormLabel>Est. hours</FormLabel><FormControl><Input type="number" min={0} {...field} /></FormControl></FormItem>
                )} />
              </div>
              <FormField control={form.control} name="description" render={({ field }) => (
                <FormItem><FormLabel>Description</FormLabel><FormControl><Textarea rows={2} {...field} /></FormControl></FormItem>
              )} />
              <DialogFooter>
                <Button type="submit" disabled={saveMutation.isPending}>{saveMutation.isPending ? 'Saving...' : editing ? 'Save' : 'Add'}</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {view === 'wbs' ? (
        <WbsView project={project} canEdit={canEdit} isAdmin={isAdmin} onOpen={openEdit} onAddChild={openCreate} onDelete={(id) => deleteMutation.mutate(id)} onMove={(id, dir) => moveMutation.mutate({ id, direction: dir })} />
      ) : view === 'board' ? (
        <TaskBoard tasks={project.tasks} milestones={project.milestones} projectKey={project.key ?? null} canEdit={canEdit}
          onMove={(id, status) => statusMutation.mutate({ id, status })} onEdit={openEdit} onDelete={(id) => deleteMutation.mutate(id)} />
      ) : view === 'timeline' ? (
        <TaskGantt project={ganttProject} onEdit={openEdit} />
      ) : view === 'group' ? (
        <div className="space-y-6">
          {groups.map((g) => (
            <div key={g.id ?? 'unassigned'} className="rounded-lg border">
              <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-2">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <Flag className="size-4 text-muted-foreground" />{g.name}<span className="text-xs text-muted-foreground">{g.tasks.length}</span>
                </span>
                {g.id && (
                  <Button size="sm" variant="ghost" className="h-7 text-destructive hover:text-destructive"
                    onClick={async () => { if (await confirm({ title: `Delete milestone "${g.name}"?`, description: 'Its tasks become unassigned.', destructive: true, confirmText: 'Delete' })) deleteMilestone.mutate(g.id!); }}>
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
              {g.tasks.length === 0 ? <p className="px-3 py-3 text-sm text-muted-foreground">No tasks in this milestone.</p> : (
                <div className="overflow-x-auto"><Table><TableHeader><HeaderRow /></TableHeader><TableBody><TaskRows tasks={g.tasks} /></TableBody></Table></div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto border-t">
          <Table><TableHeader><HeaderRow /></TableHeader>
            <TableBody>
              {project.tasks.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">No tasks yet.</TableCell></TableRow>}
              <TaskRows tasks={project.tasks} />
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
