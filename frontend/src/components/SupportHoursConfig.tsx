import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

/** The configurable support-hours settings, shared by the client contract
 *  screen and the per-product terms screens. */
export interface SupportHoursConfigValue {
  hoursPeriod: 'FULL_AMC' | 'MONTHLY';
  carryForward: boolean;
  /** Whether the client may still raise tickets once the allowance is spent. */
  allowTicketsAfterHours: boolean;
  allowExcess: boolean;
  excessApproval: boolean;
  excessApproverId: string;
}

/** Live current-month availability, shown when carry-forward is on. */
export interface SupportHoursLive {
  currentAllocated: number | null;
  carriedIn: number;
  currentUsed: number;
  available: number | null;
}

interface Props {
  value: SupportHoursConfigValue;
  onChange: (patch: Partial<SupportHoursConfigValue>) => void;
  staff: { id: string; username: string }[];
  live?: SupportHoursLive | null;
  /** Hide the whole block when the pool is Unlimited (nothing to cap or carry). */
  disabled?: boolean;
}

// This RadioGroup fires onValueChange on every click (even the current option),
// so each handler ignores a no-op re-pick — the convention across these screens.
function YesNo({ value, onChange, disabled }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <RadioGroup value={value ? 'YES' : 'NO'} disabled={disabled}
      onValueChange={(v) => { if (v && (v === 'YES') !== value) onChange(v === 'YES'); }} className="flex gap-5">
      <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="YES" /> Yes</label>
      <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="NO" /> No</label>
    </RadioGroup>
  );
}

export default function SupportHoursConfig({ value, onChange, staff, live, disabled }: Props) {
  if (disabled) return null;
  const monthly = value.hoursPeriod === 'MONTHLY';
  return (
    <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Support hours are counted</label>
        <RadioGroup value={value.hoursPeriod}
          onValueChange={(v) => { if (v && v !== value.hoursPeriod) onChange({ hoursPeriod: v as 'FULL_AMC' | 'MONTHLY' }); }} className="flex gap-5">
          <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="MONTHLY" /> Per month</label>
          <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="FULL_AMC" /> For the whole AMC</label>
        </RadioGroup>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">
          Carry forward un-utilized hours{!monthly && <span className="ml-1 text-muted-foreground/70">(monthly only)</span>}
        </label>
        <YesNo value={value.carryForward} disabled={!monthly} onChange={(v) => onChange({ carryForward: v })} />
      </div>

      {monthly && value.carryForward && live && (
        <div className="grid grid-cols-3 gap-2 rounded-md border bg-background/60 p-2 text-center text-xs">
          <div><div className="text-muted-foreground">This month</div><div className="font-semibold text-foreground">{live.currentAllocated ?? '—'} h</div></div>
          <div><div className="text-muted-foreground">Prev. un-utilized</div><div className="font-semibold text-foreground">{live.carriedIn} h</div></div>
          <div><div className="text-muted-foreground">Available</div><div className="font-semibold text-emerald-600 dark:text-emerald-400">{live.available ?? '—'} h</div></div>
        </div>
      )}

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Allow the client to raise tickets after support hours are over</label>
        <YesNo value={value.allowTicketsAfterHours} onChange={(v) => onChange({ allowTicketsAfterHours: v })} />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Allow logging excess hours (beyond the allowance)</label>
        <YesNo value={value.allowExcess} onChange={(v) => onChange({ allowExcess: v })} />
      </div>

      {value.allowExcess && (
        <div className="space-y-1.5 border-l-2 border-border pl-3">
          <label className="text-xs font-medium text-muted-foreground">Approval required for excess hours?</label>
          <YesNo value={value.excessApproval} onChange={(v) => onChange({ excessApproval: v })} />
          {value.excessApproval && (
            <div className="space-y-1 pt-1">
              <label className="text-xs text-muted-foreground">Approver</label>
              <select
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={value.excessApproverId}
                onChange={(e) => onChange({ excessApproverId: e.target.value })}>
                <option value="">Select an approver…</option>
                {staff.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
              </select>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
