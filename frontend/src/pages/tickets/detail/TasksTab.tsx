import { useEffect, useRef, useState, type ReactNode, type SyntheticEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2, MessageSquare, AlignLeft, CircleDot, AtSign, Calendar, Clock, Timer } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import api from '../../../lib/api';
import { useAuth } from '../../../context/AuthContext';
import { useConfirm } from '@/hooks/useConfirm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CellPopover } from '@/components/ui/cell-popover';
import WorklogSection from './WorklogSection';
import TaskTimePopover from './TaskTimePopover';
import TaskComments from './TaskComments';
import { useWorklogInvalidate, useWorklogs } from './ticketQueries';
import TicketTaskDialog from './TicketTaskDialog';
import { TASK_STATUSES, hrs, isSettledTask, taskStatusLabel, taskStatusPill } from './taskMeta';

export interface Task {
  id: string;
  title: string;
  status: string;
  assigneeUserId?: string | null;
  assigneeName?: string | null;
  dueDate?: string | null;
  hoursSpent?: number | string | null;
  commentCount?: number;
}
export interface UserOption { id: string; username: string; }

export default function TasksTab({ ticketId }: { ticketId: string }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { confirm, ConfirmDialog } = useConfirm();
  const [addOpen, setAddOpen] = useState(false);
  // The rows ticked for a bulk action. Kept as ids rather than indexes so a
  // refetch that reorders or drops a task can't silently retarget the selection.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Which task's detail dialog is up. Null closes it.
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState('');
  const [dueDate, setDueDate] = useState('');

  // Only the consultant a task belongs to moves its status; a tenant admin may
  // correct one. Same rule the backend enforces, mirrored here so the control is
  // simply disabled rather than bouncing off a 403.
  const isAdmin = !!user?.roles.includes('Admin');
  const mayTrack = (t: Task) => isAdmin || (!!t.assigneeUserId && t.assigneeUserId === user?.id);

  const { data: tasks = [] } = useQuery<Task[]>({
    queryKey: ['ticket-tasks', ticketId],
    queryFn: async () => (await api.get(`/api/tickets/${ticketId}/tasks`)).data,
  });
  const { data: users = [] } = useQuery<UserOption[]>({
    queryKey: ['users'],
    queryFn: async () => (await api.get('/api/users')).data,
  });
  // Not a total for display — the per-row Time spent figures and the delete
  // confirmation are filtered out of this one cache entry.
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
    // Task time is audit only and charges nothing, but the ticket's open-task
    // count gates resolving it, so the ticket itself still has to be refetched.
    qc.invalidateQueries({ queryKey: ['tickets', ticketId] });
  };
  const create = useMutation({
    mutationFn: () => api.post(`/api/tickets/${ticketId}/tasks`, {
      title,
      assigneeUserId: assignee || undefined,
      dueDate: dueDate || undefined,
    }),
    onSuccess: () => { invalidate(); setAddOpen(false); setTitle(''); setAssignee(''); setDueDate(''); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error adding task'),
  });
  const patch = useMutation({
    mutationFn: ({ taskId, data }: { taskId: string; data: Record<string, unknown> }) =>
      api.patch(`/api/tickets/${ticketId}/tasks/${taskId}`, data),
    onSuccess: invalidate,
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error updating task'),
  });
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
  const mayTrackAll = chosen.length > 0 && chosen.every(mayTrack);

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Add task</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Title</label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Order replacement part" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Assignee</label>
                  <Select value={assignee || undefined} onValueChange={setAssignee}>
                    <SelectTrigger className="w-full"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                    <SelectContent>
                      {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.username}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Due date</label>
                  <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => create.mutate()} disabled={!title.trim() || create.isPending}>Add</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* A grid, so the figures that matter per task — the hours booked against
            it and the size of its thread — read down a column instead of being
            buried in a run of interpuncts. */}
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
                    title={mayTrackAll ? undefined : 'Only a task\u2019s assignee or an admin can move its status'}>
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
              <TableHead className="w-full border-r"><HeadLabel icon={AlignLeft}>Task</HeadLabel></TableHead>
              <TableHead className="border-r"><HeadLabel icon={CircleDot}>Status</HeadLabel></TableHead>
              <TableHead className="border-r"><HeadLabel icon={AtSign}>Assignee</HeadLabel></TableHead>
              <TableHead className="border-r"><HeadLabel icon={Calendar}>Due</HeadLabel></TableHead>
              <TableHead className="border-r"><HeadLabel icon={Clock}>Log time</HeadLabel></TableHead>
              <TableHead className="border-r"><HeadLabel icon={Timer}>Time spent</HeadLabel></TableHead>
              <TableHead className="border-r"><HeadLabel icon={MessageSquare}>Comments</HeadLabel></TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={9} className="text-center text-muted-foreground">No tasks yet.</TableCell>
              </TableRow>
            ) : tasks.map((t) => {
              const canTrack = mayTrack(t);
              // What Time spent reports: the hours hand-logged against this task
              // and charged to the contract. Filtered out of the one cache entry
              // that already holds the whole ticket's entries — no request of its
              // own. `hoursSpent` is the other figure entirely: how long the task
              // stood in progress, derived from the status trail and never
              // billed, so it rides along in the tooltip rather than competing
              // for the column.
              const logged = logs
                .filter((l) => l.taskId === t.id)
                .reduce((sum, l) => sum + Number(l.hours), 0);
              const elapsed = Number(t.hoursSpent ?? 0);
              // Every cell that carries a control stops the click, or using it
              // also pops the task dialog the row opens.
              const stop = {
                onClick: (e: SyntheticEvent) => e.stopPropagation(),
                onKeyDown: (e: SyntheticEvent) => e.stopPropagation(),
              };
              return (
                <TableRow
                  key={t.id}
                  className="cursor-pointer"
                  data-state={selected.has(t.id) ? 'selected' : undefined}
                  onClick={() => setOpenTaskId(t.id)}
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
                  <TableCell className={`w-full border-r whitespace-normal ${isSettledTask(t.status) ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                    {t.title}
                    {t.status === 'CANCELLED' && <span className="ml-2 text-xs no-underline">(cancelled)</span>}
                  </TableCell>

                  {/* The status is the task's clock: every change is stamped, and
                      the trail is what the dialog shows as its audit. Rendered as
                      a bare pill — the select's box, padding and shadow are
                      stripped so a column of these reads at a glance, and the
                      chevron fades in on hover to say it is still editable. */}
                  <TableCell className="border-r" {...stop}>
                    <Select
                      value={t.status}
                      disabled={!canTrack}
                      onValueChange={(v) => {
                        if (!v || v === t.status) return;
                        // Done means the work is finished *and booked*. Mirrors
                        // the backend gate so the agent hears why here rather
                        // than bouncing off a 400. Cancelling stays free.
                        if (v === 'DONE' && logged <= 0) {
                          toast.error(`Log the time spent on "${t.title}" before marking it done`);
                          return;
                        }
                        patch.mutate({ taskId: t.id, data: { status: v } });
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
                      ? <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-foreground">{new Date(t.dueDate).toLocaleDateString()}</span>
                      : <span className="text-muted-foreground">—</span>}
                  </TableCell>

                  <TableCell className="border-r" {...stop}>
                    <TaskTimePopover ticketId={ticketId} task={t} />
                  </TableCell>

                  <TableCell
                    className={`border-r tabular-nums ${logged > 0 ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}
                    title={
                      'Hours logged against this task and charged to the contract'
                      + (elapsed > 0 ? ` · stood in progress for ${hrs(elapsed)}, audit only` : '')
                    }
                  >
                    {logged > 0 ? hrs(logged) : '—'}
                  </TableCell>

                  <TableCell className="border-r" {...stop}>
                    <CellPopover
                      width={380}
                      estimatedHeight={320}
                      trigger={({ toggle }) => (
                        <Button
                          size="sm" variant="outline" className="h-7 px-2"
                          onClick={toggle} title="Comments on this task"
                        >
                          <MessageSquare className="size-3.5" />
                          {t.commentCount ? <span className="tabular-nums">{t.commentCount}</span> : 'Comment'}
                        </Button>
                      )}
                    >
                      {() => (
                        <div className="space-y-2">
                          <div className="text-xs font-medium text-muted-foreground">
                            Comments on <span className="text-foreground">{t.title}</span>
                          </div>
                          <TaskCommentsPanel ticketId={ticketId} taskId={t.id} />
                        </div>
                      )}
                    </CellPopover>
                  </TableCell>

                  <TableCell {...stop}>
                    <Button
                      size="icon" variant="ghost" className="size-8 text-destructive hover:text-destructive"
                      title="Delete task"
                      onClick={() => confirmRemove(t)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
            {/* The foot of the grid is where a new row is added, so that is where
                the control lives — not in a band of its own above the table. */}
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={9} className="p-0">
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
        onClose={() => setOpenTaskId(null)}
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

/**
 * The task's thread inside a popover, scrolled to its foot on open.
 *
 * `TaskComments` orders oldest-first with the composer below it — the same
 * thread the task dialog and the Comments tab render, off the same cache entry,
 * so a count can never disagree with the list it labels. In a panel this short
 * that puts both the newest comments and the box you type in below the fold,
 * hence the nudge.
 */
function TaskCommentsPanel({ ticketId, taskId }: { ticketId: string; taskId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);
  return (
    <div ref={ref} className="max-h-64 overflow-y-auto">
      <TaskComments ticketId={ticketId} taskId={taskId} />
    </div>
  );
}
