import { useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '../../../lib/api';
import { Clock, FileText, Trash2, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { type ReopenWindow } from './ReopenControl';
import { useDateFormat } from '@/lib/dateFormat';
import { useAddWorklog, useDeleteWorklog, useWorklogs } from './ticketQueries';
import { hrs } from './taskMeta';

/** Column heading: icon + small muted label (copied per page, like the other list tables). */
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

export interface ResolutionTicket extends ReopenWindow {
  id: string;
  resolution?: string | null;
  resolvedAt?: string | null;
  acknowledgedAt?: string | null;
  reopenedCount?: number | null;
  /** Why the client last sent it back, and who did it — staff see both. */
  reopenReason?: string | null;
  reopenedAt?: string | null;
  reopenedByName?: string | null;
}

/**
 * The resolution editor. The ticket's resolved/acknowledged state and every
 * action on it — Acknowledge & close, Reopen, the reopen-window hint — live in
 * the green banner above the tabs, so this tab carries none of that: one green
 * bar on the screen, not two.
 */
export default function ResolutionTab({
  ticket,
  readOnly = false,
  loggedHours = 0,
  openTasks = 0,
  onViewTasks,
}: {
  ticket: ResolutionTicket;
  readOnly?: boolean;
  /** Total worklog hours on the ticket — a resolution needs more than zero. */
  loggedHours?: number;
  /** Tasks still neither done nor cancelled — a resolution needs none of these. */
  openTasks?: number;
  onViewTasks?: () => void;
}) {
  const qc = useQueryClient();
  const { fmtDateTime } = useDateFormat();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['tickets', ticket.id] });
    qc.invalidateQueries({ queryKey: ['tickets'] });
    qc.invalidateQueries({ queryKey: ['ticket-activity', ticket.id] });
  };

  const save = useMutation({
    mutationFn: (resolution: string) => api.put(`/api/tickets/${ticket.id}/resolution`, { resolution }),
    onSuccess: () => { invalidate(); toast.success(resolved ? 'Resolution updated' : 'Ticket resolved'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error saving resolution'),
  });
  const resolved = !!ticket.resolvedAt;

  /**
   * The ticket came back at least once. `reopenedCount` is the durable signal —
   * `reopenReason` only holds the latest one — so a reopened ticket is never
   * described as "not resolved yet", which is true of the current state but reads
   * as though the ticket had never been worked.
   */
  const wasReopened = (ticket.reopenedCount ?? 0) > 0 || !!ticket.reopenReason;

  /**
   * The reopen notice, shown while a reopened ticket is unresolved. The client
   * gets neutral wording — they performed the reopen, so naming them back is
   * noise; staff get the operational detail they act on: who, when, and why.
   */
  const reopenNotice = (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:border-amber-900 dark:bg-amber-950/20">
      {readOnly ? (
        <span className="text-amber-800 dark:text-amber-300">
          This ticket has been reopened and is now being reviewed.
        </span>
      ) : (
        <>
          <span className="font-medium text-amber-800 dark:text-amber-300">
            Reopened by {ticket.reopenedByName ?? 'the client'}
            {ticket.reopenedAt ? ` on ${fmtDateTime(ticket.reopenedAt)}` : ''}
            {ticket.reopenReason ? ':' : ''}
          </span>
          {ticket.reopenReason && (
            <> <span className="whitespace-pre-wrap text-foreground">{ticket.reopenReason}</span></>
          )}
        </>
      )}
    </div>
  );

  // Customers get a read-only view: they can see the resolution but cannot author
  // or edit it — that's a staff action.
  if (readOnly) {
    return (
      <div className="max-w-2xl space-y-4">
        {/* Resolved is the banner's story. Here: why it came back, or that it
            has not been resolved at all yet. */}
        {!resolved && (wasReopened ? reopenNotice : (
          <div className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
            This ticket has not been resolved yet.
          </div>
        ))}

        <div className="space-y-1.5">
          <label className="text-sm font-medium">Resolution notes</label>
          <div className="min-h-24 whitespace-pre-wrap rounded-md border bg-muted/40 px-3 py-2 text-sm text-foreground">
            {ticket.resolution?.trim() || <span className="text-muted-foreground">No resolution notes yet.</span>}
          </div>
        </div>
      </div>
    );
  }

  // Staff get the editor. Its time section reads the worklog list, which is a
  // staff-only route — so it lives in its own component, mounted only here, and
  // a customer's read-only view above never requests it.
  return (
    <ResolutionEditor
      ticketId={ticket.id}
      resolved={resolved}
      notice={!resolved && wasReopened ? reopenNotice : null}
      currentResolution={ticket.resolution ?? ''}
      loggedHours={loggedHours}
      openTasks={openTasks}
      onViewTasks={onViewTasks}
      onResolve={(text) => save.mutateAsync(text)}
      saving={save.isPending}
    />
  );
}

/**
 * The staff resolution editor: one box, and the record of what went into it.
 *
 * **The resolution notes live inside the Log time box.** Each entry is notes +
 * hours, booked as one worklog with no `taskId` (the note carries the notes), so
 * an agent who resolves a ticket themselves records the work and its time in one
 * place without raising a task for themselves. **Log time** adds an entry;
 * **Mark resolved** opens the same box as **Log & resolve**, where the notes are
 * required — they become the ticket's resolution, the text the client
 * acknowledges — and the hours too unless the ticket already has time. One click
 * books the entry and resolves. The server keeps every gate: notes, time > 0, no
 * open tasks.
 */
function ResolutionEditor({
  ticketId, resolved, notice, currentResolution, loggedHours, openTasks, onViewTasks, onResolve, saving,
}: {
  ticketId: string;
  resolved: boolean;
  notice: ReactNode;
  /** The resolution saved on the ticket — prefilled when resolving or updating it. */
  currentResolution: string;
  loggedHours: number;
  openTasks: number;
  onViewTasks?: () => void;
  onResolve: (text: string) => Promise<unknown>;
  saving: boolean;
}) {
  const { fmtDate } = useDateFormat();
  const { data: worklogs = [] } = useWorklogs(ticketId);
  const add = useAddWorklog(ticketId);
  const remove = useDeleteWorklog(ticketId);
  // Entries booked against the ticket itself; task hours stay with their task.
  const entries = worklogs.filter((l) => !l.taskId);

  // The box is always on screen. 'log' = add an entry; 'resolve' = the same box
  // after Mark resolved / Update resolution, whose button resolves as well.
  const [prompt, setPrompt] = useState<'log' | 'resolve'>('log');
  const [hours, setHours] = useState('');
  const [notes, setNotes] = useState('');
  const close = () => { setPrompt('log'); setHours(''); setNotes(''); };
  const busy = add.isPending || saving;

  const submit = async () => {
    const typed = hours.trim() !== '';
    const h = Number(hours);
    const text = notes.trim();
    if (!text) { toast.error('Write the resolution notes'); return; }
    // Every entry is notes + hours — both are always required.
    if (!typed) { toast.error(prompt === 'resolve' ? 'Enter the hours spent before resolving' : 'Enter the hours spent'); return; }
    if (!(h > 0)) { toast.error('Enter hours greater than 0'); return; }
    try {
      // Booked first, so the hours just typed are what satisfy the resolve gate.
      await add.mutateAsync({ hours: h, note: text });
      // Resolving saves the notes as the resolution; on an already-resolved
      // ticket every Add does the same, so the resolution the client reads is
      // always the latest — there is no separate Update resolution step.
      if (prompt === 'resolve' || resolved) await onResolve(text);
      else toast.success('Time logged');
      close();
    } catch { /* the failing mutation has already shown the server's reason */ }
  };

  // Outstanding tasks are checked on the click, in the status dropdown's order;
  // everything else is asked for in the box.
  const clickResolve = () => {
    if (openTasks > 0) {
      toast.error(`${openTasks} task${openTasks === 1 ? ' is' : 's are'} still open — complete or cancel ${openTasks === 1 ? 'it' : 'them'} before resolving`);
      onViewTasks?.();
      return;
    }
    // Keep whatever is already typed; otherwise start from any saved resolution
    // (a reopened ticket keeps its last one).
    if (!notes.trim()) setNotes(currentResolution);
    setPrompt('resolve');
  };


  return (
    <div className="max-w-2xl space-y-4">
      {/* Resolved is the banner's story; an unresolved ticket that came back says
          why here. A ticket that was never resolved says nothing. */}
      {notice}

      {/* The first thing on the tab: notes + hours, always open. */}
      <div className="space-y-3 rounded-lg border bg-muted/40 p-3">
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground">
              Resolution notes
            </label>
            <Textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder={prompt === 'resolve' || resolved ? 'Describe how the issue was resolved — the client sees this' : 'Describe the work done'} />
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">Hours</label>
              <Input
                type="number" min={0} step="0.25" inputMode="decimal"
                className="h-8 w-28" value={hours}
                onChange={(e) => setHours(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} />
            </div>
            <div className="ml-auto flex gap-2">
              {/* Cancel backs out of resolving; in plain logging it just clears. */}
              {(prompt === 'resolve' || notes || hours) && (
                <Button size="sm" variant="ghost" disabled={busy} onClick={close}>{prompt === 'resolve' ? 'Cancel' : 'Clear'}</Button>
              )}
              <Button size="sm" disabled={busy} onClick={submit}>
                {prompt === 'log'
                  ? (busy ? 'Saving…' : 'Add')
                  : busy ? 'Saving…' : 'Log & resolve'}
              </Button>
            </div>
          </div>
      </div>

      {/* Audit history: every entry — its notes and its time — as the standard
          list table. Task hours stay with their task; the total covers both. */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-medium text-foreground">Audit history</h3>
          <span className="text-xs text-muted-foreground">
            Ticket total <span className="font-medium text-foreground">{hrs(loggedHours)}</span> · counts towards the client's support hours
          </span>
        </div>
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="border-r"><HeadLabel icon={FileText}>Resolution notes</HeadLabel></TableHead>
                <TableHead className="w-px border-r"><HeadLabel icon={Clock}>Time spent</HeadLabel></TableHead>
                <TableHead className="w-px text-right text-xs font-semibold text-muted-foreground">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="py-4 text-center text-sm text-muted-foreground">No time logged here yet.</TableCell>
                </TableRow>
              ) : entries.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="border-r">
                    <span className="block max-w-[28rem] truncate text-sm text-foreground" title={l.note ?? undefined}>
                      {l.note || <span className="text-muted-foreground">—</span>}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {fmtDate(l.workDate)}{l.consultantName ? ` · ${l.consultantName}` : ''}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap border-r text-sm font-semibold tabular-nums">{hrs(Number(l.hours))}</TableCell>
                  <TableCell className="text-right">
                    <Button size="icon" variant="ghost" className="size-8 text-destructive hover:text-destructive"
                      title="Delete entry" disabled={remove.isPending} onClick={() => remove.mutate(l.id)}>
                      <Trash2 className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Only an unresolved ticket has a resolve step; a resolved one updates its
          resolution through Add. Hidden while resolving: the box's button acts then. */}
      {!resolved && prompt === 'log' && (
        <Button onClick={clickResolve} disabled={busy}>Mark resolved</Button>
      )}
    </div>
  );
}
