import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Clock } from 'lucide-react';
import { stampExcess, type ExcessRequest } from './excessHoursQueries';

/**
 * One excess-hours request, standing on its own rather than as a row inside the
 * pool's settings card.
 *
 * It exists for the pool that has been **superseded**: switching a client to one
 * shared customer contract stops the per-product pools governing anything, and
 * `ClientProductPage` then hides the whole coverage/terms/support block — which
 * used to take any live request on that product down with it. The request was
 * left decidable by the API but reachable from no screen at all, while the
 * approver's banner and the notification both still deep-linked here.
 *
 * Deliberately not folded into `SupportHoursConfig`: that component is the
 * pool's own settings panel, and this request no longer belongs to a pool that
 * governs. Who may decide mirrors the backend rule — the named approver or a
 * tenant Admin, and only while PENDING.
 */
export default function ExcessRequestCard({
  request,
  productName,
  superseded,
  canDecide,
  deciding,
  onDecide,
}: {
  request: ExcessRequest;
  productName?: string | null;
  /** True when the client has since moved to one shared customer contract. */
  superseded?: boolean;
  canDecide?: boolean;
  deciding?: boolean;
  onDecide?: (approve: boolean) => void;
}) {
  const decided = request.status !== 'PENDING';
  const picked = request.status === 'APPROVED' ? 'APPROVE' : request.status === 'REJECTED' ? 'REJECT' : '';

  return (
    <section className="space-y-3 rounded-lg border bg-card p-4">
      <h2 className="flex items-center gap-1.5 text-base font-semibold text-foreground">
        <Clock className="size-4" /> Excess support hours
        {request.periodLabel !== 'ALL' && <span className="text-sm font-normal text-muted-foreground">· {request.periodLabel}</span>}
      </h2>

      {superseded && (
        <p className="rounded-lg border bg-muted/20 p-3 text-sm text-muted-foreground">
          This client has since moved to one shared customer contract, so
          {productName ? ` ${productName}'s` : ' this product’s'} own allowance no longer governs their hours.
          The request is kept here so it can still be settled and cleared from the approver’s queue.
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t pt-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground">
            {decided
              ? `${request.status === 'APPROVED' ? 'Approved' : 'Declined'} by ${request.approverName ?? 'the approver'}`
              : `${request.requestedByName ?? 'A consultant'} asked to log beyond ${request.allocated} h`}
          </div>
          <div className="text-xs text-muted-foreground">
            {decided
              ? request.decidedAt ? stampExcess(request.decidedAt) : ''
              : `${Number(request.usedAtRequest)} h of ${request.allocated} h already used · awaiting ${request.approverName ?? 'the approver'}`}
          </div>
        </div>
        <RadioGroup
          value={picked}
          disabled={!canDecide || deciding}
          onValueChange={(v) => { if (v && v !== picked) onDecide?.(v === 'APPROVE'); }}
          className="flex gap-5"
        >
          <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="APPROVE" /> Approve</label>
          <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="REJECT" /> Reject</label>
        </RadioGroup>
      </div>
    </section>
  );
}
