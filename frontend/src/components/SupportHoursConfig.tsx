import type { ReactNode } from 'react';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';
import { stampExcess, type ExcessRequest } from './excessHoursQueries';

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
  /** Staff who are not tenant Admins read these settings; only the excess
   *  decision below stays live for them. */
  readOnly?: boolean;
  /** Saved approver, shown as text in place of the picker when read-only. */
  approverName?: string | null;
  /** The live excess-hours request for this pool, decided inline below. */
  request?: ExcessRequest | null;
  /** True only for the named approver or a tenant Admin, and only while PENDING. */
  canDecide?: boolean;
  onDecide?: (approve: boolean) => void;
  deciding?: boolean;
}

/** One setting: label on the left, its control on the right. */
function Row({ label, hint, indent, children }: { label: string; hint?: string; indent?: boolean; children: ReactNode }) {
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
function YesNo({ value, onChange, disabled }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <RadioGroup value={value ? 'YES' : 'NO'} disabled={disabled}
      onValueChange={(v) => { if (v && (v === 'YES') !== value) onChange(v === 'YES'); }} className="flex gap-5">
      <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="YES" /> Yes</label>
      <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="NO" /> No</label>
    </RadioGroup>
  );
}

export default function SupportHoursConfig({
  value, onChange, staff, live, readOnly, approverName, request, canDecide, onDecide, deciding,
}: Props) {
  const monthly = value.hoursPeriod === 'MONTHLY';
  // The decision is a permission, not a time entry — it belongs with the setting
  // that demands it rather than in a panel of its own further down the page.
  const decided = request && request.status !== 'PENDING';
  const picked = request?.status === 'APPROVED' ? 'APPROVE' : request?.status === 'REJECTED' ? 'REJECT' : '';

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

      {value.allowExcess && (
        <Row label="Approval required for excess hours?" indent>
          <YesNo value={value.excessApproval} disabled={readOnly} onChange={(v) => onChange({ excessApproval: v })} />
        </Row>
      )}

      {value.allowExcess && value.excessApproval && (
        <Row label="Approver" indent>
          {readOnly ? (
            <span className="text-sm text-foreground">{approverName ?? 'Not set'}</span>
          ) : (
            <select
              className="h-8 w-48 rounded-md border border-input bg-background px-2 text-sm"
              value={value.excessApproverId}
              onChange={(e) => onChange({ excessApproverId: e.target.value })}>
              <option value="">Select an approver…</option>
              {staff.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
            </select>
          )}
        </Row>
      )}

      {/* The one live request on this pool, decided in place. Only the named
          approver or a tenant Admin gets a live radio — everyone else reads it. */}
      {value.allowExcess && value.excessApproval && request && (
        <Row
          label={decided
            ? `Excess hours ${request.status === 'APPROVED' ? 'approved' : 'rejected'}${request.periodLabel !== 'ALL' ? ` · ${request.periodLabel}` : ''}`
            : `Waiting for approval from ${request.approverName ?? 'the approver'}${request.periodLabel !== 'ALL' ? ` · ${request.periodLabel}` : ''}`}
          hint={decided
            ? `${request.status === 'APPROVED' ? 'Approved' : 'Declined'} by ${request.approverName ?? 'the approver'}${request.decidedAt ? ` · ${stampExcess(request.decidedAt)}` : ''}`
            : `Logging beyond the ${request.allocated} h allowance needs their sign-off (${Number(request.usedAtRequest)} h used so far).`}
          indent>
          <RadioGroup value={picked} disabled={!canDecide || deciding}
            onValueChange={(v) => { if (v && v !== picked) onDecide?.(v === 'APPROVE'); }} className="flex gap-5">
            <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="APPROVE" /> Approve</label>
            <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="REJECT" /> Reject</label>
          </RadioGroup>
        </Row>
      )}
    </div>
  );
}
