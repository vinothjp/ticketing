import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useDateFormat } from '@/lib/dateFormat';

export interface ReopenWindow {
  /** Tenant's reopen window, in days after `resolvedAt` (default 30). */
  reopenWindowDays?: number | null;
  /** When the window closes; null while the ticket is unresolved. */
  reopenDeadline?: string | null;
  /** Whether the window is still open. Purely about time — not about the viewer. */
  reopenWindowOpen?: boolean;
}

/**
 * The one reopen affordance on the ticket screen — it sits in the Resolution tab's
 * status row, after Acknowledge & close. The banner at the top of the page only
 * links here, so the actions live in exactly one place.
 *
 * Reopening is the client's judgement that the fix didn't hold, so on a customer's
 * ticket only their own people get a button; provider staff (admins and consultants)
 * see the info icon alone, which says who may reopen and until when. An internal
 * ticket has no client to make the call, so staff keep it there. The same rule is
 * enforced in `TicketsService.reopen`.
 *
 * Clicking Reopen asks for a reason first: it's what the assigned agents and the
 * tenant admins receive as a notification, so the API requires it.
 *
 * Once the window has closed the button becomes a "New ticket" link, because a
 * fresh issue after this long is a new ticket rather than a revival. The hint is
 * a bare icon to keep the row on one line; the full explanation — who may reopen,
 * how long, and the exact date — is on hover and on keyboard focus, so a missing
 * button never reads as a bug.
 */
export default function ReopenControl({
  ticket,
  canReopen,
  onReopen,
  reopening,
  requestMode = false,
  approverName = null,
}: {
  ticket: ReopenWindow;
  /** True only for whoever owns the call — the client, or staff on an internal ticket. */
  canReopen: boolean;
  onReopen: (reason: string) => void;
  reopening: boolean;
  /**
   * A customer's ticket is not reopened on the spot: the client *asks*, and the
   * client product's project manager (or an Admin) approves. The button, dialog
   * and hint say so. Off for an internal ticket, which staff reopen directly.
   */
  requestMode?: boolean;
  /** Who decides the request, when a project manager is set — named in the dialog. */
  approverName?: string | null;
}) {
  const { fmtDate } = useDateFormat();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');

  const days = ticket.reopenWindowDays ?? 30;
  const deadline = ticket.reopenDeadline ? new Date(ticket.reopenDeadline) : null;
  // Absent from an older payload = treat as open, and let the API be the judge.
  const windowOpen = ticket.reopenWindowOpen !== false;
  const until = deadline ? ` (until ${fmtDate(deadline)})` : '';
  const decider = approverName ? `${approverName} (project manager)` : 'your provider';
  const hint = !canReopen
    ? `Only the client can ask to reopen their own ticket, for ${days} days after it is resolved${until}. The project manager approves the request before it reopens.`
    : !windowOpen
      ? `The ${days}-day reopening window closed${deadline ? ` on ${fmtDate(deadline)}` : ''}. Raise a new ticket for this issue instead.`
      : requestMode
        ? `You can ask to reopen this ticket for ${days} days after it was resolved${until}. It reopens once ${decider} approves.`
        : `You can reopen this ticket for ${days} days after it was resolved${until}. After that, please raise a new ticket.`;

  const submit = () => {
    const trimmed = reason.trim();
    if (!trimmed) return;
    onReopen(trimmed);
    setOpen(false);
    setReason('');
  };

  return (
    <div className="flex items-center gap-1">
      {canReopen && (windowOpen ? (
        <Button variant="outline" size="sm" onClick={() => setOpen(true)} disabled={reopening}>
          {requestMode ? 'Request reopen' : 'Reopen'}
        </Button>
      ) : (
        <Button variant="outline" size="sm" asChild>
          <Link to="/tickets/new">Create new ticket</Link>
        </Button>
      ))}

      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="About the reopening window"
              className="rounded-full p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <Info className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{hint}</TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{requestMode ? 'Request to reopen this ticket' : 'Reopen ticket'}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            {requestMode
              ? `The ticket stays closed until ${decider} approves your request. You'll get an email and a notification with the decision.`
              : 'Tell us what the resolution missed. The assigned agents and the support admins are notified with this note.'}
          </p>
          <Textarea
            rows={4}
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. The printer went offline again the next morning"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={!reason.trim() || reopening}>
              {requestMode ? (reopening ? 'Sending…' : 'Send for approval') : (reopening ? 'Reopening…' : 'Reopen ticket')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
