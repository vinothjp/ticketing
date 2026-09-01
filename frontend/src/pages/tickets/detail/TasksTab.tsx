import { useState, type ReactNode, type SyntheticEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Plus, Trash2, Pencil, AlignLeft, CircleDot, AtSign, Calendar, Timer, Hash,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import api from '../../../lib/api';
import { useAuth } from '../../../context/AuthContext';
import { useConfirm } from '@/hooks/useConfirm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import WorklogSection from './WorklogSection';
import { useWorklogInvalidate, useWorklogs } from './ticketQueries';
import TicketTaskDialog from './TicketTaskDialog';
import { useDateFormat } from '@/lib/dateFormat';
import {
  COMPLETED_TASK_STATUS, TASK_STATUSES, hrs, isSettledTask, taskCode, taskStatusLabel, taskStatusPill,
} from './taskMeta';

export interface Task {
  id: string;
  /** Per-ticket sequence, shown as T-001. Null only on rows that predate the column. */
  taskNumber?: number | null;
  title: string;
  status: string;
  assigneeUserId?: string | null;
  assigneeName?: string | null;
  dueDate?: string | null;
  /** What the task was expected to take — the default the log-time prompt offers. */
  estimatedHours?: number | string | null;
  hoursSpent?: number | string | null;
  commentCount?: number;
}
export interface UserOption { id: string; username: string; }

export default function TasksTab({
  ticketId,
  ticketAssigneeId,
}: {
  ticketId: string;
  /** The agent the *ticket* is assigned to — who, with an admin, may reopen a completed task. */
  ticketAssigneeId?: string | null;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { fmtDate } = useDateFormat();
  const { confirm, ConfirmDialog } = useConfirm();
  const [addOpen, setAddOpen] = useState(false);
  // The rows ticked for a bulk action. Kept as ids rather than indexes so a
  // refetch that reorders or drops a task can't silently retarget the selection.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Which task's edit dialog is up. Null closes it. Both doors into it — the row
  // itself and the Edit action — set this, so there is one editor, not two.
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  // A status picked in the grid is not written here: it is handed to the edit
  // dialog, which is where the time spent on the move is entered.
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [estimate, setEstimate] = useState('');
  const [assignee, setAssignee] = useState('');
  const [dueDate, setDueDate] = useState('');

  // Only the consultant a task belongs to moves its status; a tenant admin may
  // correct one. Same rule the backend enforces, mirrored here so the control is
  // simply disabled rather than bouncing off a 403.
  const isAdmin = !!user?.roles.includes('Admin');
  const mayTrack = (t: Task) => isAdmin || (!!t.assigneeUserId && t.assigneeUserId === user?.id);

  // Reopening a completed task is a different right from running it: it belongs
  // to the agent the *ticket* is assigned to, or an admin — deliberately not the
  // task's own assignee, who is the person that called it finished. Mirrors
  // `assertMayReopen` on the backend.
  const mayReopen = isAdmin || (!!ticketAssigneeId && ticketAssigneeId === user?.id);
  const isCompleted = (t: Task) => t.status === COMPLETED_TASK_STATUS;

  const { data: tasks = [] } = useQuery<Task[]>({
    queryKey: ['ticket-tasks', ticketId],
    queryFn: async () => (await api.get(`/api/tickets/${ticketId}/tasks`)).data,
  });

  const { data: users = [] } = useQuery<UserOption[]>({
    queryKey: ['users'],
    queryFn: async () => (await api.get('/api/users')).data,
  });
  // Not a total for display — the delete confirmation says what hours go with the
  // task, and the dialog prefills its log-time prompt from what is already booked.
  const { data: logs = [] } = useWorklogs(ticketId);

  // A task deleted elsewhere must fall out of the selection, or a bulk action
  // would fire at an id that no longer exists.
  const chosen = tasks.filter((t) => selected.has(t.id));
  const allChosen = tasks.length > 0 && chosen.length === tasks.length;
  const toggleOne = (id: string, on: boolean) => setSelected((prev) => {
    const next = new Set(prev);
    if (on) next.add(id); else next.delete(id);
    return next;
  });
  const toggleAll = (on: boolean) => setSelected(on ? new Set(tasks.map((t) => t.id)) : new Set());
  const clearSelection = () => setSelected(new Set());

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['ticket-tasks', ticketId] });
    qc.invalidateQueries({ queryKey: ['ticket-task'] });
    qc.invalidateQueries({ queryKey: ['ticket-activity', ticketId] });
    // The ticket's open-task count gates resolving it, so the ticket itself still
    // has to be refetched.
    qc.invalidateQueries({ queryKey: ['tickets', ticketId] });
  };
  const closeAdd = () => {
    setAddOpen(false);
    setTitle(''); setDescription(''); setEstimate(''); setAssignee(''); setDueDate('');
  };
  const create = useMutation({
    mutationFn: () => api.post(`/api/tickets/${ticketId}/tasks`, {
      title,
      description: description.trim() || undefined,
      // Sent as a number or not at all — an empty box means "no estimate", not zero.
      estimatedHours: estimate.trim() ? Number(estimate) : undefined,
      assigneeUserId: assignee || undefined,
      dueDate: dueDate || undefined,
    }),
    onSuccess: () => { invalidate(); closeAdd(); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error adding task'),
  });

  const patch = useMutation({
    mutationFn: ({ taskId, data }: { taskId: string; data: Record<string, unknown> }) =>
      api.patch(`/api/tickets/${ticketId}/tasks/${taskId}`, data),
    onSuccess: invalidate,
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error updating task'),
  });

  /**
   * A status picked in the grid, routed by what the move still needs.
   *
   * Three moves have something to collect, and each opens the task's edit screen
   * with the move queued rather than writing it: **Completed** wants the hours
   * the task took, **In progress** on an unassigned task wants whoever is taking
   * it, and leaving Completed is a reopen and wants its reason. Every other move
   * — pausing a task, cancelling one, starting one that already has an assignee —
   * asks nothing, so it is written straight from the pill.
   */
  const askStatus = (task: Task, to: string) => {
    const needsInput =
      to === COMPLETED_TASK_STATUS
      || isCompleted(task)
      || (to === 'IN_PROGRESS' && !task.assigneeUserId);
    if (!needsInput) {
      patch.mutate({ taskId: task.id, data: { status: to } });
      return;
    }
    setPendingStatus(to);
    setOpenTaskId(task.id);
  };

  const openTask = (taskId: string) => {
    setPendingStatus(null);
    setOpenTaskId(taskId);
  };

  const invalidateWorklogs = useWorklogInvalidate(ticketId);
  const remove = useMutation({
    mutationFn: (taskId: string) => api.delete(`/api/tickets/${ticketId}/tasks/${taskId}`),
    // The task takes its logged hours with it, so this has to clear everything a
    // worklog delete clears — the header chip, the support-hours pool and the
    // customer's own product screens all read those.
    onSuccess: (res) => {
      invalidate();
      invalidateWorklogs();
      setOpenTaskId(null);
      const { worklogsRemoved = 0, hoursRemoved = 0 } = res.data ?? {};
      toast.success(worklogsRemoved
        ? `Task deleted · ${hrs(hoursRemoved)} credited back to the support hours`
        : 'Task deleted');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error removing task'),
  });

  // Deleting a task destroys the hours booked against it and credits them back to
  // the customer's pool, so say what will go before it goes.
  const confirmRemove = async (t: Task) => {
    const booked = logs.filter((l) => l.taskId === t.id).reduce((sum, l) => sum + Number(l.hours), 0);
    const ok = await confirm({
      title: `Delete "${t.title}"?`,
      description: booked > 0
        ? `${hrs(booked)} logged against this task will be deleted too and credited back to the customer's support hours. This cannot be undone.`
        : 'This also removes its comments and status history. This cannot be undone.',
      destructive: true,
      confirmText: 'Delete',
    });
    if (ok) remove.mutate(t.id);
  };

  // Bulk actions run one at a time, not in parallel: deleting a task reverses its
  // hours against the customer's support-hours ledger, and concurrent writes to
  // the same month's row would race each other.
  const [bulkBusy, setBulkBusy] = useState(false);
  const runBulk = async (label: string, fn: (t: Task) => Promise<unknown>) => {
    setBulkBusy(true);
    let done = 0;
    const failures: string[] = [];
    for (const t of chosen) {
      try { await fn(t); done += 1; } catch (e: any) {
        failures.push(e?.response?.data?.message || t.title);
      }
    }
    setBulkBusy(false);
    clearSelection();
    invalidate();
    invalidateWorklogs();
    if (done) toast.success(`${label} ${done} task${done === 1 ? '' : 's'}`);
    // Named rather than counted — a refusal is nearly always a permission rule,
    // and the reason is the useful half.
    if (failures.length) toast.error(`${failures.length} failed · ${failures[0]}`);
  };

  // A bulk move books no time — there is one figure to type and many tasks, so
  // the hours belong on each task's own edit screen. A task that has nothing
  // logged against it is refused Completed here, exactly as the API refuses it.
  const bulkStatus = (status: string) =>
    runBulk('Updated', (t) => api.patch(`/api/tickets/${ticketId}/tasks/${t.id}`, { status }));
  const bulkAssign = (assigneeUserId: string) =>
    runBulk('Reassigned', (t) => api.patch(`/api/tickets/${ticketId}/tasks/${t.id}`, { assigneeUserId }));
  const bulkDelete = async () => {
    const booked = chosen.reduce(
      (sum, t) => sum + logs.filter((l) => l.taskId === t.id).reduce((n, l) => n + Number(l.hours), 0),
      0,
    );
    const ok = await confirm({
      title: `Delete ${chosen.length} task${chosen.length === 1 ? '' : 's'}?`,
      description: booked > 0
        ? `${hrs(booked)} logged against them will be deleted too and credited back to the customer's support hours. This cannot be undone.`
        : 'This also removes their comments and status history. This cannot be undone.',
      destructive: true,
      confirmText: 'Delete',
    });
    if (ok) await runBulk('Deleted', (t) => api.delete(`/api/tickets/${ticketId}/tasks/${t.id}`));
  };

  // Mirrors `assertMayTrack`: only a task's own assignee or a tenant Admin moves
  // its status, so the bulk control is offered only when every ticked row
  // qualifies — rather than firing and collecting 403s.
  // A completed row is deliberately excluded: reopening one demands a reason, so
  // it happens from its own edit screen where that can be asked for.
  const mayTrackAll = chosen.length > 0 && chosen.every((t) => mayTrack(t) && !isCompleted(t));

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Dialog open={addOpen} onOpenChange={(o) => { if (!o) closeAdd(); }}>
          <DialogContent>
            <DialogHeader><DialogTitle>Add task</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Title</label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Order replacement part" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Description</label>
                <Textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What does this task involve?"
                />
              </div>
              {/* The estimate is asked for here because it is what the log-time
                  prompt offers as its default when the task's status moves — so
                  the usual case is a confirm rather than a figure typed twice. */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Estimated hours</label>
                  <Input
                    type="number" min="0" step="0.25" inputMode="decimal"
                    value={estimate}
                    onChange={(e) => setEstimate(e.target.value)}
                    placeholder="e.g. 2"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Due date</label>
                  <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Assignee</label>
                <Select value={assignee || undefined} onValueChange={setAssignee}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                  <SelectContent>
                    {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.username}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => create.mutate()} disabled={!title.trim() || create.isPending}>Add</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Only present while something is ticked, so the grid is uncluttered at
            rest and the actions appear exactly when they can be used. */}
        {chosen.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2">
            <span className="text-sm font-medium text-foreground">
              {chosen.length} selected
            </span>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" disabled={bulkBusy || !mayTrackAll}
                    title={mayTrackAll ? undefined
                      : chosen.some(isCompleted)
                        ? 'Reopen a completed task from its own edit screen — it needs a reason'
                        : 'Only a task’s assignee or an admin can move its status'}>
                    Status
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {TASK_STATUSES.map((st) => (
                    <DropdownMenuItem key={st.value} onSelect={() => bulkStatus(st.value)}>
                      {st.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" disabled={bulkBusy}>Assign</Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-h-64 overflow-y-auto">
                  <DropdownMenuItem onSelect={() => bulkAssign('')}>Unassigned</DropdownMenuItem>
                  {users.map((u) => (
                    <DropdownMenuItem key={u.id} onSelect={() => bulkAssign(u.id)}>{u.username}</DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              <Button size="sm" variant="outline" disabled={bulkBusy}
                className="text-destructive hover:text-destructive" onClick={bulkDelete}>
                <Trash2 className="size-4" /> Delete
              </Button>
              <Button size="sm" variant="ghost" disabled={bulkBusy} onClick={clearSelection}>Clear</Button>
            </div>
          </div>
        )}

        <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            {/* Task takes w-full so it absorbs the slack: the rest size to their
                content instead of the table spreading a gap through every cell.
                Everything is left-aligned so each heading sits over its own
                values. The ticket's running total isn't repeated here — the page
                header's "Time spent" chip already carries it. */}
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead className="border-r p-0">
                <div className="flex w-14 items-center justify-center">
                  <Checkbox
                    aria-label="Select all tasks"
                    disabled={tasks.length === 0}
                    // Indeterminate whenever the tick is partial, so the header
                    // never claims everything is selected when it isn't.
                    checked={allChosen ? true : chosen.length > 0 ? 'indeterminate' : false}
                    onCheckedChange={(v) => toggleAll(v === true)}
                  />
                </div>
              </TableHead>
              <TableHead className="border-r"><HeadLabel icon={Hash}>Task ID</HeadLabel></TableHead>
              <TableHead className="w-full border-r"><HeadLabel icon={AlignLeft}>Task</HeadLabel></TableHead>
              <TableHead className="border-r"><HeadLabel icon={CircleDot}>Status</HeadLabel></TableHead>
              <TableHead className="border-r"><HeadLabel icon={AtSign}>Assignee</HeadLabel></TableHead>
              <TableHead className="border-r"><HeadLabel icon={Calendar}>Due</HeadLabel></TableHead>
              <TableHead className="border-r"><HeadLabel icon={Timer}>Time spent</HeadLabel></TableHead>
              <TableHead className="w-px" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={8} className="text-center text-muted-foreground">No tasks yet.</TableCell>
              </TableRow>
            ) : tasks.map((t) => {
              const completed = isCompleted(t);
              // Moving a completed task at all is a reopen, so the status dropdown
              // opens to the ticket's agent and admins even when they are not the
              // task's assignee, and to nobody else.
              const canEditStatus = completed ? mayReopen : mayTrack(t);
              const spent = Number(t.hoursSpent ?? 0);
              // Every cell that carries a control stops the click, or using it
              // also opens the edit dialog the row opens.
              const stop = {
                onClick: (e: SyntheticEvent) => e.stopPropagation(),
                onKeyDown: (e: SyntheticEvent) => e.stopPropagation(),
              };
              return (
                <TableRow
                  key={t.id}
                  className="cursor-pointer"
                  data-state={selected.has(t.id) ? 'selected' : undefined}
                  onClick={() => openTask(t.id)}
                >
                  <TableCell className="border-r p-0" {...stop}>
                    <div className="flex w-14 items-center justify-center py-3">
                      <Checkbox
                        aria-label={`Select ${t.title}`}
                        checked={selected.has(t.id)}
                        onCheckedChange={(v) => toggleOne(t.id, v === true)}
                      />
                    </div>
                  </TableCell>

                  {/* The task's own id, so a task can be named in a comment or a
                      call without quoting its whole title. Per ticket, and never
                      reused once a task is deleted. */}
                  <TableCell className="border-r font-mono text-xs whitespace-nowrap text-muted-foreground">
                    {taskCode(t)}
                  </TableCell>

                  <TableCell className={`w-full border-r whitespace-normal ${isSettledTask(t.status) ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                    {t.title}
                    {t.status === 'CANCELLED' && <span className="ml-2 text-xs no-underline">(cancelled)</span>}
                  </TableCell>

                  {/* The status is the task's clock: every change is stamped, and
                      the trail is what the edit screen shows as its audit.
                      Rendered as a bare pill — the select's box, padding and
                      shadow are stripped so a column of these reads at a glance,
                      and the chevron fades in on hover to say it is still
                      editable. Picking a value opens the edit screen rather than
                      writing: that is where the time it took is entered. */}
                  <TableCell className="border-r" {...stop}>
                    <Select
                      value={t.status}
                      disabled={!canEditStatus}
                      onValueChange={(v) => {
                        if (!v || v === t.status) return;
                        askStatus(t, v);
                      }}
                    >
                      <SelectTrigger
                        size="sm"
                        className="w-auto gap-1 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 disabled:opacity-100 [&>svg]:opacity-0 [&>svg]:transition-opacity hover:[&>svg]:opacity-60 data-[state=open]:[&>svg]:opacity-60"
                      >
                        <span className={`rounded px-1.5 py-0.5 text-xs font-bold uppercase ${taskStatusPill(t.status)}`}>
                          {taskStatusLabel(t.status)}
                        </span>
                      </SelectTrigger>
                      <SelectContent>
                        {TASK_STATUSES.map((s) => (
                          <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>

                  <TableCell className="border-r">
                    {t.assigneeName ? (
                      <span className="flex items-center gap-2">
                        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
                          {t.assigneeName.slice(0, 2).toUpperCase()}
                        </span>
                        <span className="text-foreground">{t.assigneeName}</span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Unassigned</span>
                    )}
                  </TableCell>

                  <TableCell className="border-r">
                    {t.dueDate
                      ? <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-foreground">{fmtDate(t.dueDate)}</span>
                      : <span className="text-muted-foreground">—</span>}
                  </TableCell>

                  <TableCell
                    className={`border-r tabular-nums whitespace-nowrap ${spent > 0 ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}
                    title="Time logged against this task and charged to the contract"
                  >
                    {spent > 0 ? hrs(spent) : '—'}
                  </TableCell>

                  <TableCell className="w-px whitespace-nowrap" {...stop}>
                    <div className="flex items-center justify-end">
                      <Button
                        size="icon" variant="ghost" className="size-8"
                        title="Edit task"
                        onClick={() => openTask(t.id)}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        size="icon" variant="ghost" className="size-8 text-destructive hover:text-destructive"
                        title="Delete task"
                        onClick={() => confirmRemove(t)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {/* The foot of the grid is where a new row is added, so that is where
                the control lives — not in a band of its own above the table. */}
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={8} className="p-0">
                <button
                  type="button"
                  onClick={() => setAddOpen(true)}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                >
                  <Plus className="size-4" /> Add task
                </button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
        </div>
      </div>

      {/* Only the entries that belong to no task — task time is already totalled
          in its own row. Renders nothing at all when there are none, so it owns
          its heading rather than leaving an empty one behind. */}
      <WorklogSection ticketId={ticketId} />

      {ConfirmDialog}

      <TicketTaskDialog
        ticketId={ticketId}
        taskId={openTaskId}
        users={users}
        canTrack={(t) => mayTrack(t)}
        canReopen={mayReopen}
        pendingStatus={pendingStatus}
        onPendingHandled={() => setPendingStatus(null)}
        onClose={() => { setOpenTaskId(null); setPendingStatus(null); }}
        onDelete={(taskId) => {
          const t = tasks.find((x) => x.id === taskId);
          if (t) confirmRemove(t);
        }}
      />
    </div>
  );
}

/**
 * A column heading: its icon, then its label. Muted and small, so the headings
 * read as chrome and the values below them carry the weight.
 */
function HeadLabel({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
      <Icon className="size-3.5 shrink-0" />
      {children}
    </span>
  );
}
