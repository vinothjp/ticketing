import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';

/**
 * Whether this client's tickets are auto-routed to a consultant at all, shared
 * by the customer-contract and per-product Terms cards so both read the same.
 *
 * The value is per *client*, not per product — it gates routing whatever the
 * contractScope is — so the per-product screen says so in its hint. The two
 * Terms cards are mutually exclusive by scope, so every client shows exactly one
 * of these.
 *
 * This RadioGroup is the hand-rolled one: it fires onValueChange on every click,
 * including the option already selected, so a no-op re-pick is ignored here
 * rather than in each caller — the control writes the moment it is touched.
 */
export default function AutoAssignChoice({
  value,
  onChange,
  hint,
  className,
  disabled,
}: {
  value: boolean;
  onChange: (enabled: boolean) => void;
  hint?: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-5 gap-y-1.5', className)}>
      <span className="text-sm font-medium text-foreground">Auto assignment</span>
      <RadioGroup
        value={value ? 'YES' : 'NO'}
        disabled={disabled}
        onValueChange={(v) => { if (v && (v === 'YES') !== value) onChange(v === 'YES'); }}
        className="flex gap-5"
      >
        <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="YES" /> Yes</label>
        <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="NO" /> No</label>
      </RadioGroup>
      <span className="text-xs text-muted-foreground">
        {hint ?? (value
          ? 'New tickets go to the first free consultant.'
          : 'Every ticket is created unassigned.')}
      </span>
    </div>
  );
}
