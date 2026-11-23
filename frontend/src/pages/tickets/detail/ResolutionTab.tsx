import { useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '../../../lib/api';
import { Check, Clock, FileText, Pencil, X, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { type ReopenWindow } from './ReopenControl';
import { useDateFormat } from '@/lib/dateFormat';
import { useAddWorklog, useUpdateWorklog, useWorklogs } from './ticketQueries';
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
  closed = false,
}: {
  ticket: ResolutionTicket;
  /** The live status reads Closed — entries are read-only then. */
  closed?: boolean;
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
      reopenedAt={ticket.reopenedAt ?? null}
      closed={closed}
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
 * **The resolution notes live inside the time box**, and a ticket holds **one**
 * such entry: notes + hours, booked as a worklog with no `taskId` (the server
 * refuses a second). The box's own **Mark resolved** button books the entry and
 * resolves in one click — the notes become the ticket's resolution, the text the
 * client acknowledges. Once the entry exists the box is gone; an unresolved
 * ticket that already has one (a reopen) resolves on it with a bare Mark
 * resolved, and deleting the entry brings the box back. The server keeps every
 * gate: notes, time > 0, no open tasks.
 */
function ResolutionEditor({
  ticketId, resolved, closed, notice, reopenedAt, loggedHours, openTasks, onViewTasks, onResolve, saving,
}: {
  ticketId: string;
  resolved: boolean;
  /** Entries are editable in every state but Closed; the Actions column goes with it. */
  closed: boolean;
  notice: ReactNode;
  /** Start of the current resolution round — entries before it are history. */
  reopenedAt: string | null;
  loggedHours: number;
  openTasks: number;
  onViewTasks?: () => void;
  onResolve: (text: string) => Promise<unknown>;
  saving: boolean;
}) {
  const { fmtDate } = useDateFormat();
  const { data: worklogs = [] } = useWorklogs(ticketId);
  const add = useAddWorklog(ticketId);
  const update = useUpdateWorklog(ticketId);
  // The one row being corrected, inline: its id and the draft values.
  const [editing, setEditing] = useState<{ id: string; note: string; hours: string } | null>(null);
  const saveEdit = async () => {
    if (!editing) return;
    const note = editing.note.trim();
    const h = Number(editing.hours);
    if (!note) { toast.error('Resolution notes cannot be empty'); return; }
    if (!(h > 0)) { toast.error('Enter hours greater than 0'); return; }
    try {
      await update.mutateAsync({ id: editing.id, note, hours: h });
      setEditing(null);
      toast.success('Entry updated');
    } catch { /* toast already shown */ }
  };
  // Entries booked against the ticket itself; task hours stay with their task.
  // ONE entry per resolution round (the server refuses a second): once this
  // round's exists the box is gone. A reopen starts a new round — earlier
  // entries stay in Audit history, locked, and the box comes back.
  const entries = worklogs.filter((l) => !l.taskId);
  const roundStart = reopenedAt ? new Date(reopenedAt).getTime() : null;
  const inRound = (l: { createdAt?: string }) =>
    roundStart === null || (!!l.createdAt && new Date(l.createdAt).getTime() > roundStart);
  const entry = entries.find(inRound);

  const [hours, setHours] = useState('');
  // A reopened round starts blank — the last resolution sits in Audit history below.
  const [notes, setNotes] = useState('');
  const busy = add.isPending || saving;

  // Outstanding tasks are checked first, in the status dropdown's order.
  const tasksBlock = () => {
    if (openTasks === 0) return false;
    toast.error(`${openTasks} task${openTasks === 1 ? ' is' : 's are'} still open — complete or cancel ${openTasks === 1 ? 'it' : 'them'} before resolving`);
    onViewTasks?.();
    return true;
  };

  /** The box's button: books notes + hours and, on an unresolved ticket, resolves in the same click. */
  const submit = async () => {
    if (!resolved && tasksBlock()) return;
    const text = notes.trim();
    const h = Number(hours);
    if (!text) { toast.error('Write the resolution notes'); return; }
    if (hours.trim() === '') { toast.error(resolved ? 'Enter the hours spent' : 'Enter the hours spent before resolving'); return; }
    if (!(h > 0)) { toast.error('Enter hours greater than 0'); return; }
    try {
      // Booked first, so the hours just typed are what satisfy the resolve gate.
      await add.mutateAsync({ hours: h, note: text });
      // The notes become the resolution the client reads — on resolving, and on
      // an already-resolved ticket alike.
      await onResolve(text);
      setHours('');
    } catch { /* the failing mutation has already shown the server's reason */ }
  };

  /** An entry already exists (e.g. a reopened ticket): resolve on it, no second log. */
  const resolveWithEntry = async () => {
    if (tasksBlock()) return;
    const text = (entry?.note ?? '').trim();
    if (!text) { toast.error('The entry has no resolution notes'); return; }
    try { await onResolve(text); } catch { /* toast already shown */ }
  };


  return (
    <div className="max-w-2xl space-y-4">
      {/* Resolved is the banner's story; an unresolved ticket that came back says
          why here. A ticket that was never resolved says nothing. */}
      {notice}

      {/* The first thing on the tab: notes + hours, until the one entry is logged. */}
      {resolved ? null : !entry ? (
        <div className="space-y-3 rounded-lg border bg-muted/40 p-3">
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground">
              Resolution notes
            </label>
            <Textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Describe how the issue was resolved — the client sees this" />
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
            <Button className="ml-auto" disabled={busy} onClick={submit}>
              {busy ? 'Saving…' : 'Mark resolved'}
            </Button>
          </div>
        </div>
      ) : (
        // Logged but not resolved — a reopened ticket, or a resolve that was
        // refused after booking. Resolve on the entry rather than logging again.
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-3">
          <span className="text-sm text-muted-foreground">
            Time for this round is logged below.
          </span>
          <Button className="ml-auto" disabled={busy} onClick={resolveWithEntry}>
            {busy ? 'Saving…' : 'Mark resolved'}
          </Button>
        </div>
      )}

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
                <TableHead className={`w-px ${closed ? '' : 'border-r'}`}><HeadLabel icon={Clock}>Time spent</HeadLabel></TableHead>
                {/* No column at all once Closed — it comes back on a reopen. */}
                {!closed && (
                  <TableHead className="w-px text-right text-xs font-semibold text-muted-foreground">Actions</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={closed ? 2 : 3} className="py-4 text-center text-sm text-muted-foreground">No time logged here yet.</TableCell>
                </TableRow>
              ) : entries.map((l) => editing?.id === l.id && !closed ? (
                <TableRow key={l.id} className="hover:bg-transparent">
                  <TableCell className="border-r">
                    <Textarea rows={2} value={editing.note} autoFocus
                      onChange={(e) => setEditing({ ...editing, note: e.target.value })} />
                  </TableCell>
                  <TableCell className="border-r">
                    <Input type="number" min={0} step="0.25" inputMode="decimal" className="h-8 w-20"
                      value={editing.hours}
                      onChange={(e) => setEditing({ ...editing, hours: e.target.value })}
                      onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditing(null); }} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    <Button size="icon" variant="ghost" className="size-8" title="Save"
                      disabled={update.isPending} onClick={saveEdit}>
                      <Check className="size-4" />
                    </Button>
                    <Button size="icon" variant="ghost" className="size-8" title="Cancel"
                      disabled={update.isPending} onClick={() => setEditing(null)}>
                      <X className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ) : (
                <TableRow key={l.id}>
                  <TableCell className="border-r">
                    <span className="block max-w-[28rem] truncate text-sm text-foreground" title={l.note ?? undefined}>
                      {l.note || <span className="text-muted-foreground">—</span>}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {fmtDate(l.workDate)}{l.consultantName ? ` · ${l.consultantName}` : ''}
                    </span>
                  </TableCell>
                  <TableCell className={`whitespace-nowrap text-sm font-semibold tabular-nums ${closed ? '' : 'border-r'}`}>{hrs(Number(l.hours))}</TableCell>
                  {!closed && (
                    <TableCell className="text-right">
                      <Button size="icon" variant="ghost" className="size-8" title="Edit entry"
                        onClick={() => setEditing({ id: l.id, note: l.note ?? '', hours: String(Number(l.hours)) })}>
                        <Pencil className="size-4" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
