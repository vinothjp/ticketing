import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '../../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import type { ClientVisit } from './clientVisitsMeta';

/** The outcomes a consultant reports; a visit can never be un-planned from here. */
const REPORT_STATUSES = [
  { value: 'VISITED', label: 'Visited', hint: 'Draws one visit from the client\u2019s allowance.' },
  {
    value: 'RESCHEDULE_REQUESTED',
    label: 'Request reschedule',
    hint: 'An admin is notified and picks the new date. Nothing is drawn from the allowance.',
  },
] as const;

/**
 * The consultant's half of a client visit: confirm the hours actually spent and
 * report the outcome. Everything else about the visit is the admin's to set, so
 * it is shown read-only here — matching what the API will accept.
 */
export function VisitReportDialog({ visit, onClose }: { visit: ClientVisit | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [hours, setHours] = useState('');
  const [status, setStatus] = useState('');
  const [notes, setNotes] = useState('');

  // Re-seed each time a different visit is opened.
  useEffect(() => {
    if (!visit) return;
    setHours(String(visit.hours ?? 0));
    setStatus(visit.status === 'PLANNED' ? '' : visit.status);
    setNotes(visit.notes ?? '');
  }, [visit?.id]);

  const save = useMutation({
    mutationFn: async () => {
      if (!visit) return;
      await api.patch(`/api/client-visits/${visit.id}`, {
        hours: hoursNum,
        status: status || visit.status,
        notes: notes.trim() || undefined,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['client-visits'] });
      toast.success('Visit updated');
      onClose();
    },
    onError: () => toast.error('Failed to update the visit'),
  });

  const chosen = REPORT_STATUSES.find((s) => s.value === status);
  // Hours are the consultant's to report, and the admin who booked the visit had
  // no way to know them — so they are required here even though the create form
  // leaves them blank. A reschedule request is the one outcome where zero is the
  // honest answer: nobody was on site.
  const hoursNum = Number(hours);
  const hoursValid = hours.trim() !== '' && Number.isFinite(hoursNum) && hoursNum >= 0;
  const needsPositiveHours = status === 'VISITED';
  const hoursError = !hoursValid
    ? 'Enter the hours you spent'
    : needsPositiveHours && hoursNum <= 0
      ? 'A visit that took place needs more than zero hours'
      : null;

  return (
    <Dialog open={!!visit} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{visit?.visitNumber ?? 'Client visit'}</DialogTitle>
          <DialogDescription>Report the hours you spent and how the visit went.</DialogDescription>
        </DialogHeader>

        {visit && (
          <div className="space-y-4">
            <dl className="grid grid-cols-3 gap-x-3 gap-y-1.5 rounded-lg border bg-muted/30 p-3 text-sm">
              <dt className="col-span-1 text-muted-foreground">Client</dt>
              <dd className="col-span-2">{visit.customerCompany?.name ?? '-'}</dd>
              <dt className="col-span-1 text-muted-foreground">Date</dt>
              <dd className="col-span-2">{new Date(visit.visitDate).toLocaleDateString()}</dd>
              <dt className="col-span-1 text-muted-foreground">Product</dt>
              <dd className="col-span-2">{visit.productName || '-'}</dd>
              <dt className="col-span-1 text-muted-foreground">Purpose</dt>
              <dd className="col-span-2">{visit.purpose}</dd>
            </dl>

            <div className="space-y-1.5">
              <Label htmlFor="visit-hours">Hours spent <span className="text-destructive">*</span></Label>
              <Input
                id="visit-hours"
                type="number"
                min="0"
                step="0.5"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                aria-invalid={!!hoursError}
              />
              {status && hoursError && <p className="text-xs text-destructive">{hoursError}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>Outcome</Label>
              {/* Plain buttons, not a Select: two options, and the consequence of
                  each needs to be visible before it is picked. */}
              <div className="grid grid-cols-2 gap-2">
                {REPORT_STATUSES.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => setStatus(s.value)}
                    className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                      status === s.value
                        ? 'border-primary bg-primary/10 text-foreground'
                        : 'text-muted-foreground hover:bg-accent'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <p className="min-h-4 text-xs text-muted-foreground">{chosen?.hint}</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="visit-notes">Notes</Label>
              <Textarea
                id="visit-notes"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="What was done on site?"
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={!status || !!hoursError || save.isPending}>
            {save.isPending ? 'Saving\u2026' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
