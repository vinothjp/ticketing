import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Trash2, Timer, Gauge } from 'lucide-react';
import api from '../../../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Combobox } from '@/components/ui/combobox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { COMPLETED_TASK_STATUS, TASK_STATUSES, hrs, taskCode } from './taskMeta';
import type { Task, UserOption } from './TasksTab';
import TaskComments from './TaskComments';
import { useWorklogInvalidate, useWorklogs } from './ticketQueries';
import { staffLabel } from '@/lib/staffLabel';

const UNASSIGNED = '__none__';

interface TaskDetail extends Task {
  description?: string | null;
}

const toDateInput = (v?: string | null) => (v ? new Date(v).toISOString().slice(0, 10) : '');

/**
 * One task's edit screen — the single door the grid's row click and its Edit
 * action both open.
 *
 * It carries the task's own fields (title, status, assignee, due date, estimate,
 * description), the time booked against it, and its comment thread. **Nothing
 * saves on change** (client request — no auto-save anywhere on the ticket
 * screen): every field, and any status move — picked here, or handed over by the
 * grid as `pendingStatus` — is a draft until the footer's **Save**, which writes
 * them in one PATCH. Closing with unsaved changes asks first. A move to Completed
 * asks for the hours it cost, prefilled from the estimate less what is already
 * booked. Comments keep their own Post button, as on every screen.
 */
export default function TicketTaskDialog({
  ticketId,
  taskId,
  users,
  canTrack,
  canEdit,
  canReopen,
  pendingStatus,
  onPendingHandled,
  onClose,
  onDelete,
}: {
  ticketId: string;
  taskId: string | null;
  users: UserOption[];
  canTrack: (task: Task) => boolean;
  /** Title, description, assignee and due date: the ticket's agent, the task's assignee, or an admin. */
  canEdit: (task: Task) => boolean;
  /** Whether the viewer may pull a completed task back open — the ticket's agent, or an admin. */
  canReopen: boolean;
  /** A move picked in the grid, queued for the panel below rather than written there. */
  pendingStatus?: string | null;
  /** Clears that queued move once it has been confirmed or dropped. */
  onPendingHandled: () => void;
  onClose: () => void;
  onDelete: (taskId: string) => void;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  // A status picked *here*. The move queued by the grid arrives as a prop, so the
  // panel is derived from the two rather than copied into state by an effect —
  // an effect would re-prefill a box the consultant had already corrected on
  // every refetch.
  const [picked, setPicked] = useState<string | null>(null);
  // Null means untouched, so the box shows the suggestion below; a typed value —
  // an empty string included — is the consultant's and is left alone.
  const [logDraft, setLogDraft] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  // Assignee and due date drafts; null = untouched (the stored value shows).
  // '' for the assignee means Unassigned.
  const [assigneeDraft, setAssigneeDraft] = useState<string | null>(null);
  const [dueDraft, setDueDraft] = useState<string | null>(null);
  // Another task opened in the same dialog starts clean.
  const [draftFor, setDraftFor] = useState(taskId);
  if (draftFor !== taskId) { setDraftFor(taskId); setAssigneeDraft(null); setDueDraft(null); }

  const { data: task } = useQuery<TaskDetail>({
    queryKey: ['ticket-task', taskId],
    queryFn: async () => (await api.get(`/api/tickets/${ticketId}/tasks/${taskId}`)).data,
    enabled: !!taskId,
  });

  // Hydrate the free-text drafts from the saved content, not from the query's
  // object identity — a refetch on window focus hands back a new object every
  // time and would wipe whatever is half-typed.
  const savedText = `${task?.title ?? ''} ${task?.description ?? ''}`;
  useEffect(() => {
    setTitle(task?.title ?? '');
    setDescription(task?.description ?? '');
  }, [savedText]);

  // Hours booked against this task. Read from the one shared worklog cache the
  // Tasks tab already fills, so the dialog costs no request of its own and can
  // never disagree with the row behind it.
  const { data: logs = [] } = useWorklogs(ticketId);
  const logged = logs
    .filter((l) => l.taskId === taskId)
    .reduce((sum, l) => sum + Number(l.hours), 0);

  const completed = task?.status === COMPLETED_TASK_STATUS;
  // The move handed over by the grid, ignored once the task already stands there.
  const queued = pendingStatus && task && pendingStatus !== task.status ? pendingStatus : null;
  const pending = picked ?? queued;
  // Leaving Completed is a reopen: it answers to a wider right and demands a
  // reason instead of an hours figure — the work was already booked when the task
  // was closed, so pulling it back open charges nothing.
  const reopening = !!pending && completed;
  // Time is asked for on **completion only**. Starting a task, pausing it or
  // cancelling one costs the customer nothing at the moment it happens; the
  // hours are what the finished task actually took, entered once, on the way
  // out. Until then the estimate is all the screen shows, and it is read-only.
  const asksForTime = pending === COMPLETED_TASK_STATUS && !reopening;
  // Work in progress is somebody's work, so starting an unassigned task waits on
  // one. There is no second picker for it: the hint points at the Assignee field
  // the form already has, and both go out together on Save. Mirrors the same refusal
  // in `TasksService.update`.
  const assigneeNow = assigneeDraft ?? task?.assigneeUserId ?? '';
  const dueNow = dueDraft ?? toDateInput(task?.dueDate);
  const asksForAssignee = pending === 'IN_PROGRESS' && !assigneeNow;
  // The fields that differ from what is stored — what Save sends.
  const fieldChanges = (): Record<string, unknown> => {
    if (!task) return {};
    const c: Record<string, unknown> = {};
    if (title.trim() !== (task.title ?? '').trim()) c.title = title.trim();
    if (description.trim() !== (task.description ?? '').trim()) c.description = description.trim();
    if (assigneeNow !== (task.assigneeUserId ?? '')) c.assigneeUserId = assigneeNow;
    if (dueNow !== toDateInput(task.dueDate)) c.dueDate = dueNow || null;
    return c;
  };
  const dirty = !!pending || Object.keys(fieldChanges()).length > 0;

  // Unassigned leads, then every agent. A task is routinely raised with nobody
  // on it, so clearing the field has to be as reachable as picking someone.
  const assigneeOptions = [
    { value: UNASSIGNED, label: 'Unassigned' },
    ...users.map((u) => ({ value: u.id, label: staffLabel(u) })),
  ];

  /**
   * What the log-time box opens with: the estimate the task was raised with,
   * less what has already been booked against it. So the first move on a task
   * offers the whole estimate, and a second one offers what is left rather than
   * charging the estimate twice.
   */
  const suggested = () => {
    const est = Number(task?.estimatedHours ?? 0);
    const left = Math.round(Math.max(0, est - logged) * 100) / 100;
    return left > 0 ? String(left) : '';
  };

  // What the box actually shows: the consultant's own figure once they have
  // touched it, the suggestion until then.
  const logValue = logDraft ?? suggested();

  // Scroll the Assignee field into view the moment a queued Start starts waiting
  // on it — the dialog body scrolls, and the field sits above the panel that
  // names it, so on a long task it would otherwise be off-screen.
  const assigneeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (asksForAssignee) assigneeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [asksForAssignee]);

  const invalidateWorklogs = useWorklogInvalidate(ticketId);
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['ticket-task', taskId] });
    qc.invalidateQueries({ queryKey: ['ticket-tasks', ticketId] });
    qc.invalidateQueries({ queryKey: ['ticket-activity', ticketId] });
    qc.invalidateQueries({ queryKey: ['tickets', ticketId] });
  };
  /**
   * Save: the changed fields and any status move (with the time it cost) in one
   * PATCH. The billable caches are cleared too — logged hours move the ticket
   * header's chip and the customer's support-hours pool, not just this list.
   */
  const applyStatus = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      api.patch(`/api/tickets/${ticketId}/tasks/${taskId}`, data),
    onSuccess: (_res, data) => {
      invalidate();
      invalidateWorklogs();
      resetDrafts();
      onClose();
      toast.success(data.reopenNote ? 'Task reopened' : 'Task saved');
    },
    // Keep the server's message: an exhausted support-hours pool, or an excess
    // request still with its approver, is what usually refuses this.
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error updating task'),
  });

  // Clears both halves: the pick made here, and the move the grid queued — the
  // parent owns that one, so it has to be told.
  const dropPending = () => {
    setPicked(null);
    setLogDraft(null);
    setNoteDraft('');
    onPendingHandled();
  };
  // Throws away every unsaved change: the status move and the field drafts.
  const resetDrafts = () => {
    dropPending();
    setAssigneeDraft(null);
    setDueDraft(null);
    setTitle(task?.title ?? '');
    setDescription(task?.description ?? '');
  };
  // Any way out but Save: ask before losing changes.
  const requestClose = () => {
    if (dirty && !applyStatus.isPending && !window.confirm('Discard your unsaved changes to this task?')) return;
    resetDrafts();
    onClose();
  };

  // Two different rights. The task's *fields* — title, description, assignee,
  // due date — belong to the ticket's agent, the task's assignee or an admin
  // (`assertMayEdit`). Gating them on the status right instead left an
  // unassigned task editable by Admins alone, so nobody could even assign it.
  // The *status* — the timesheet — belongs to the task's assignee or an admin.
  const editable = !!task && canEdit(task);
  const mayTrack = !!task && canTrack(task);
  // Moving a completed task at all is a reopen, so the status control answers to
  // that rule instead: the ticket's own agent or an admin.
  const statusEditable = completed ? canReopen : mayTrack;

  const save = () => {
    if (!task || !dirty) return;
    if (!title.trim()) return toast.error('A task needs a title');
    if (!pending) return applyStatus.mutate(fieldChanges());
    const hours = asksForTime && logValue.trim() ? Number(logValue) : 0;
    if (asksForTime && logValue.trim() && !(hours >= 0)) {
      return toast.error('Enter the time as a number of hours');
    }
    if (reopening && !noteDraft.trim()) return toast.error('Say why this task is being reopened');
    if (asksForAssignee) return toast.error('Assign this task to someone before starting it');
    // Same gate as the API: completed means the work is booked. Checked here so
    // the consultant is told to fill the box in front of them rather than
    // bouncing off a 400.
    if (asksForTime && logged + hours <= 0) {
      return toast.error(`Log the time spent on "${task.title}" before completing it`);
    }
    applyStatus.mutate({
      ...fieldChanges(),
      status: pending,
      ...(hours > 0 && { logHours: hours }),
      ...(reopening && { reopenNote: noteDraft.trim() }),
    });
  };

  return (
    <Dialog open={!!taskId} onOpenChange={(o) => { if (!o) requestClose(); }}>
      <DialogContent className="flex max-h-[calc(100svh-2rem)] w-[calc(100vw-2rem)] flex-col overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-baseline gap-2 pr-6 break-words">
            {task && <span className="font-mono text-xs text-muted-foreground">{taskCode(task)}</span>}
            <span>{task?.title ?? 'Task'}</span>
          </DialogTitle>
        </DialogHeader>

        {!task ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="-mx-1 space-y-5 overflow-y-auto px-1">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Title</label>
              <Input
                value={title}
                disabled={!editable}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Status</label>
                <Select
                  value={pending ?? task.status}
                  disabled={!statusEditable}
                  // A Radix Select resets a value it can't find among its items and
                  // fires an empty change; a real pick is never empty, so ignore it.
                  onValueChange={(v) => {
                    if (!v || v === (pending ?? task.status)) return;
                    if (v === task.status) return dropPending();
                    // Queue the move for the panel below — the hours it cost are
                    // asked for there, never saved straight off the pick.
                    setPicked(v);
                    setLogDraft(null);
                    setNoteDraft('');
                  }}
                >
                  <SelectTrigger className="w-full"><SelectValue placeholder="Status" /></SelectTrigger>
                  <SelectContent>
                    {TASK_STATUSES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5" ref={assigneeRef}>
                <label className={`text-sm font-medium ${asksForAssignee ? 'text-amber-700 dark:text-amber-400' : ''}`}>
                  Assignee
                </label>
                {/* A combobox rather than a plain select: a tenant's agent list
                    runs long enough that scrolling it to find one name is the
                    slow way round. Ringed while a queued Start is waiting on it,
                    so the panel's line below has something to point at. */}
                <Combobox
                  value={assigneeNow || UNASSIGNED}
                  disabled={!editable}
                  options={assigneeOptions}
                  placeholder="Unassigned"
                  emptyText="No agent matches that"
                  className={asksForAssignee ? 'rounded-md ring-2 ring-amber-400 ring-offset-1' : ''}
                  onChange={(v) => {
                    if (!v) return;
                    setAssigneeDraft(v === UNASSIGNED ? '' : v);
                  }}
                />
                {asksForAssignee && (
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    Pick someone to start this task.
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Due date</label>
                <Input
                  type="date"
                  disabled={!editable}
                  value={dueNow}
                  onChange={(e) => setDueDraft(e.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {/* Read-only, and deliberately so: the estimate is what the task
                  was raised against, typed once on Add task. One that could be
                  revised afterwards to match the hours actually spent would not
                  be an estimate of anything. */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Estimated hours</label>
                <div className="flex h-9 items-center gap-2 rounded-md border bg-muted/40 px-3 text-sm tabular-nums">
                  <Gauge className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className={task.estimatedHours ? 'text-foreground' : 'text-muted-foreground'}>
                    {task.estimatedHours ? hrs(Number(task.estimatedHours)) : 'Not estimated'}
                  </span>
                </div>
              </div>
              {/* One cell, two states. Normally the booked total, read-only —
                  hours are never typed straight into a total. While a move to
                  Completed is being filled in, it becomes the box that asks what
                  the task took, prefilled from the estimate less what is already
                  booked. Time is asked for on completion alone: starting,
                  pausing or cancelling a task books nothing. */}
              {asksForTime ? (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Time spent (hours)</label>
                  <Input
                    type="number" min="0" step="0.25" inputMode="decimal"
                    autoFocus
                    value={logValue}
                    onChange={(e) => setLogDraft(e.target.value)}
                    placeholder="0"
                  />
                  <p className="text-xs text-muted-foreground">
                    Charged to the customer&rsquo;s support hours.
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Time logged</label>
                  <div className="flex h-9 items-center gap-2 rounded-md border bg-muted/40 px-3 text-sm tabular-nums">
                    <Timer className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className={logged > 0 ? 'font-semibold text-foreground' : 'text-muted-foreground'}>
                      {logged > 0 ? hrs(logged) : 'Nothing logged yet'}
                    </span>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Description</label>
              <Textarea
                rows={3}
                disabled={!editable}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What does this task involve?"
              />
            </div>

            {/* A reopen is the one move that has to say why. Just another field
                while it is pending — there is no confirm panel: the status the
                dropdown shows is the move, and the footer's Save applies it. */}
            {reopening && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Why is this being reopened?</label>
                <Textarea
                  rows={3}
                  autoFocus
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  placeholder="e.g. The fix did not hold — the customer reported it again"
                />
                <p className="text-xs text-muted-foreground">
                  Recorded on the task&rsquo;s status trail and in the ticket history.
                </p>
              </div>
            )}

            {/* The task's own thread, on the screen the task is worked from. Reads
                the one shared comments cache the Comments tab uses, so a comment
                posted here shows up there without a refetch. */}
            <div className="space-y-2 border-t pt-4">
              <label className="text-sm font-medium">Comments</label>
              <TaskComments ticketId={ticketId} taskId={task.id} />
            </div>
          </div>
        )}

        <DialogFooter className="items-center gap-2">
          {task && (
            <Button
              variant="ghost"
              size="sm"
              className="mr-auto text-destructive hover:text-destructive"
              onClick={() => onDelete(task.id)}
            >
              <Trash2 className="size-4" /> Delete task
            </Button>
          )}
          <Button variant="ghost" onClick={requestClose}>{dirty ? 'Cancel' : 'Close'}</Button>
          <Button disabled={!dirty || applyStatus.isPending} onClick={save}>
            {applyStatus.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
