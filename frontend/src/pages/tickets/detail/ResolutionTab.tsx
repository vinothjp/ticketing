import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '../../../lib/api';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { type ReopenWindow } from './ReopenControl';

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
  onLogTime,
  onViewTasks,
}: {
  ticket: ResolutionTicket;
  readOnly?: boolean;
  /** Total worklog hours on the ticket — a resolution needs more than zero. */
  loggedHours?: number;
  /** Tasks still neither done nor cancelled — a resolution needs none of these. */
  openTasks?: number;
  onLogTime?: () => void;
  onViewTasks?: () => void;
}) {
  const qc = useQueryClient();
  const [resolution, setResolution] = useState(ticket.resolution ?? '');

  useEffect(() => {
    setResolution(ticket.resolution ?? '');
  }, [ticket.id, ticket.resolvedAt]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['tickets', ticket.id] });
    qc.invalidateQueries({ queryKey: ['tickets'] });
    qc.invalidateQueries({ queryKey: ['ticket-activity', ticket.id] });
  };

  const save = useMutation({
    mutationFn: () => api.put(`/api/tickets/${ticket.id}/resolution`, { resolution }),
    onSuccess: () => { invalidate(); toast.success('Ticket resolved'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error saving resolution'),
  });
  const resolved = !!ticket.resolvedAt;
  // The backend refuses a resolution with an empty timesheet, or with work still
  // outstanding; block the button rather than let the agent write notes and then
  // bounce off a 400.
  const needsTime = !resolved && loggedHours <= 0;
  const needsTasks = !resolved && openTasks > 0;

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
            {ticket.reopenedAt ? ` on ${new Date(ticket.reopenedAt).toLocaleString()}` : ''}
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
            {resolution.trim() || <span className="text-muted-foreground">No resolution notes yet.</span>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-4">
      {/* Resolved is the banner's story; an unresolved ticket that came back says
          why here. A ticket that was never resolved says nothing — the editor
          below is the whole story. */}
      {!resolved && wasReopened && reopenNotice}

      {!resolved && !resolution.trim() && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300">
          Please create a resolution message before resolving this ticket.
        </div>
      )}

      {needsTasks && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300">
          <span>
            {openTasks} task{openTasks === 1 ? ' is' : 's are'} still open on this ticket — complete
            or cancel {openTasks === 1 ? 'it' : 'them'} before resolving.
          </span>
          {onViewTasks && <Button variant="outline" size="sm" onClick={onViewTasks}>View tasks</Button>}
        </div>
      )}

      {needsTime && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300">
          <span>No time has been logged on this ticket yet — log it against a task on the Tasks tab before resolving.</span>
          {onLogTime && <Button variant="outline" size="sm" onClick={onLogTime}>Log time</Button>}
        </div>
      )}

      <div className="space-y-1.5">
        <label className="text-sm font-medium">Resolution notes</label>
        <Textarea rows={6} value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="Describe how the issue was resolved…" />
      </div>

      <Button onClick={() => save.mutate()} disabled={save.isPending || !resolution.trim() || needsTime || needsTasks}>
        {resolved ? 'Update resolution' : 'Mark resolved'}
      </Button>
    </div>
  );
}
