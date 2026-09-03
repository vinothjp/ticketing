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
 * description), the time booked against it, and its comment thread. Text commits
 * on blur and the pickers save on change, with one exception: a **status move is
 * confirmed, not saved on the pick**. Picking a status — here or in the grid,
 * which hands the move over as `pendingStatus` — raises the panel below it,
 * asking for the hours the move cost. That figure is prefilled from the estimate
 * the task was raised with, less whatever has already been booked, so the usual
 * case is a confirm rather than a number typed twice.
 */
export default function TicketTaskDialog({
  ticketId,
  taskId,
  users,
  canTrack,
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
  // one. There is no second picker for it: the panel points at the Assignee field
  // the form already has, which saves on change like every other field here — so
  // picking someone there clears this on the next read. Mirrors the same refusal
  // in `TasksService.update`.
  const asksForAssignee = pending === 'IN_PROGRESS' && !task?.assigneeUserId;

  // Unassigned leads, then every agent. A task is routinely raised with nobody
  // on it, so clearing the field has to be as reachable as picking someone.
  const assigneeOptions = [
    { value: UNASSIGNED, label: 'Unassigned' },
    ...users.map((u) => ({ value: u.id, label: u.username })),
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
  const patch = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      api.patch(`/api/tickets/${ticketId}/tasks/${taskId}`, data),
    onSuccess: invalidate,
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error updating task'),
  });

  /**
   * The confirmed status move, with the time it cost. Separate from `patch` only
   * so the panel closes and the billable caches are cleared on success — logged
   * hours move the ticket header's chip and the customer's support-hours pool,
   * not just this list.
   */
  const applyStatus = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      api.patch(`/api/tickets/${ticketId}/tasks/${taskId}`, data),
    onSuccess: (_res, data) => {
      invalidate();
      invalidateWorklogs();
      dropPending();
      onClose();
      toast.success(data.reopenNote ? 'Task reopened' : 'Status updated');
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

  const editable = !!task && canTrack(task);
  // Moving a completed task at all is a reopen, so the status control answers to
  // that rule instead: the ticket's own agent or an admin.
  const statusEditable = completed ? canReopen : editable;

  /** Save a text field only when it actually changed, on blur. */
  const commit = (field: 'title' | 'description', value: string) => {
    const saved = (field === 'title' ? task?.title : task?.description) ?? '';
    if (value.trim() === saved.trim()) return;
    if (field === 'title' && !value.trim()) return setTitle(saved);
    patch.mutate({ [field]: value.trim() });
  };

  const confirmStatus = () => {
    if (!task || !pending) return;
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
      status: pending,
      ...(hours > 0 && { logHours: hours }),
      ...(reopening && { reopenNote: noteDraft.trim() }),
    });
  };

  return (
    <Dialog open={!!taskId} onOpenChange={(o) => { if (!o) { dropPending(); onClose(); } }}>
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
                onBlur={() => commit('title', title)}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
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
                  value={task.assigneeUserId ?? UNASSIGNED}
                  disabled={!editable}
                  options={assigneeOptions}
                  placeholder="Unassigned"
                  emptyText="No agent matches that"
                  className={asksForAssignee ? 'rounded-md ring-2 ring-amber-400 ring-offset-1' : ''}
                  onChange={(v) => {
                    if (!v) return;
                    const next = v === UNASSIGNED ? '' : v;
                    if (next !== (task.assigneeUserId ?? '')) patch.mutate({ assigneeUserId: next });
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
                  value={toDateInput(task.dueDate)}
                  onChange={(e) => patch.mutate({ dueDate: e.target.value || null })}
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
                onBlur={() => commit('description', description)}
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
          {pending ? (
            <>
              <Button variant="ghost" onClick={() => { dropPending(); onClose(); }}>Cancel</Button>
              <Button disabled={applyStatus.isPending} onClick={confirmStatus}>
                {applyStatus.isPending ? 'Saving…' : 'Save'}
              </Button>
            </>
          ) : (
            <>
              <span className="text-xs text-muted-foreground">Changes save automatically</span>
              <Button onClick={onClose}>Close</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
