import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';

/**
 * Unlimited / Limited support-hours picker, shared by the customer-contract and
 * per-product coverage screens so both read the same.
 *
 * Radios rather than a switch: these are two mutually exclusive contract terms
 * and the selected one has to be obvious at a glance. Unlimited means no cap and
 * no deductions, so the quantity field is hidden entirely by the caller.
 */
export default function SupportHoursChoice({
  unlimited,
  onChange,
  label = 'Support hours',
  className,
}: {
  unlimited: boolean;
  onChange: (unlimited: boolean) => void;
  label?: string;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-5 gap-y-1.5', className)}>
      <span className="text-sm font-medium text-foreground">{label}</span>
      <RadioGroup
        value={unlimited ? 'UNLIMITED' : 'LIMITED'}
        // Ignore empty emissions — a real pick is never empty.
        onValueChange={(v) => { if (v) onChange(v === 'UNLIMITED'); }}
        className="flex gap-5"
      >
        <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="UNLIMITED" /> Unlimited</label>
        <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="LIMITED" /> Limited</label>
      </RadioGroup>
      <span className="text-xs text-muted-foreground">
        {unlimited ? 'No cap — hours are never deducted.' : 'Tracked against the hours below.'}
      </span>
    </div>
  );
}
