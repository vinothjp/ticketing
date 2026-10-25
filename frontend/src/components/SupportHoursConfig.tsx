import type { ReactNode } from 'react';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';

/** The configurable support-hours settings, shared by the client contract
 *  screen and the per-product terms screens. */
export interface SupportHoursConfigValue {
  hoursPeriod: 'FULL_AMC' | 'MONTHLY';
  carryForward: boolean;
  /** Whether the client may still raise tickets once the allowance is spent. */
  allowTicketsAfterHours: boolean;
  allowExcess: boolean;
  /** What an hour beyond the allowance is charged at; '' = not set. */
  excessRate: number | '';
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
  live?: SupportHoursLive | null;
  /** Staff who are not tenant Admins read these settings without changing them. */
  readOnly?: boolean;
  /** The excess rate is money: the server withholds it from non-Admins, so the
   *  row is not rendered for them rather than shown empty. */
  showRate?: boolean;
}

/** One setting: label on the left, its control on the right. */
export function Row({ label, hint, indent, children }: { label: string; hint?: string; indent?: boolean; children: ReactNode }) {
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 py-2', indent && 'pl-4')}>
      <div className="min-w-0">
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        {hint && <div className="text-[11px] text-muted-foreground/70">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

// This RadioGroup fires onValueChange on every click (even the current option),
// so each handler ignores a no-op re-pick — the convention across these screens.
export function YesNo({ value, onChange, disabled }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <RadioGroup value={value ? 'YES' : 'NO'} disabled={disabled}
      onValueChange={(v) => { if (v && (v === 'YES') !== value) onChange(v === 'YES'); }} className="flex gap-5">
      <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="YES" /> Yes</label>
      <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="NO" /> No</label>
    </RadioGroup>
  );
}

export default function SupportHoursConfig({ value, onChange, live, readOnly, showRate }: Props) {
  const monthly = value.hoursPeriod === 'MONTHLY';

  return (
    <div className="divide-y divide-border">
      <Row label="Support hours are counted">
        <RadioGroup value={value.hoursPeriod} disabled={readOnly}
          onValueChange={(v) => { if (v && v !== value.hoursPeriod) onChange({ hoursPeriod: v as 'FULL_AMC' | 'MONTHLY' }); }} className="flex gap-5">
          <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="MONTHLY" /> Per month</label>
          <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="FULL_AMC" /> For the whole AMC</label>
        </RadioGroup>
      </Row>

      <Row label="Carry forward un-utilized hours" hint={monthly ? undefined : 'monthly only'}>
        <YesNo value={value.carryForward} disabled={readOnly || !monthly} onChange={(v) => onChange({ carryForward: v })} />
      </Row>

      {monthly && value.carryForward && live && (
        <div className="grid grid-cols-3 gap-2 py-2 text-center text-xs">
          <div><div className="text-muted-foreground">This month</div><div className="font-semibold text-foreground">{live.currentAllocated ?? '—'} h</div></div>
          <div><div className="text-muted-foreground">Prev. un-utilized</div><div className="font-semibold text-foreground">{live.carriedIn} h</div></div>
          <div><div className="text-muted-foreground">Available</div><div className="font-semibold text-emerald-600 dark:text-emerald-400">{live.available ?? '—'} h</div></div>
        </div>
      )}

      <Row label="Allow the client to raise tickets after support hours are over">
        <YesNo value={value.allowTicketsAfterHours} disabled={readOnly} onChange={(v) => onChange({ allowTicketsAfterHours: v })} />
      </Row>

      <Row label="Allow logging excess hours (beyond the allowance)">
        <YesNo value={value.allowExcess} disabled={readOnly} onChange={(v) => onChange({ allowExcess: v })} />
      </Row>

      {value.allowExcess && showRate && (
        <Row label="Excess hours rate" hint="per hour beyond the allowance" indent>
          {readOnly ? (
            <span className="text-sm text-foreground">{value.excessRate === '' ? 'Not set' : value.excessRate}</span>
          ) : (
            <input
              type="number" min={0} step="0.01" inputMode="decimal" placeholder="Rate per hour"
              className="h-8 w-36 rounded-md border border-input bg-background px-2 text-sm"
              value={value.excessRate}
              onChange={(e) => onChange({ excessRate: e.target.value === '' ? '' : Number(e.target.value) })} />
          )}
        </Row>
      )}
    </div>
  );
}
