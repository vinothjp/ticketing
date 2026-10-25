import { Row, YesNo } from './SupportHoursConfig';
import type { ContractServicesValue } from './contractServices';

const numberBox = 'h-8 w-36 rounded-md border border-input bg-background px-2 text-sm';

/** What else a contract covers, beside its support hours — saved with the terms. */
export default function ContractServicesConfig({ value, onChange, readOnly }: {
  value: ContractServicesValue;
  onChange: (patch: Partial<ContractServicesValue>) => void;
  readOnly?: boolean;
}) {
  return (
    <div className="divide-y divide-border">
      <Row label="Third-party integration">
        <YesNo value={value.thirdPartyIntegration} disabled={readOnly} onChange={(v) => onChange({ thirdPartyIntegration: v })} />
      </Row>
      <Row label="Plan roll-out">
        <YesNo value={value.planRollout} disabled={readOnly} onChange={(v) => onChange({ planRollout: v })} />
      </Row>
      <Row label="CR applicable">
        <YesNo value={value.crApplicable} disabled={readOnly} onChange={(v) => onChange({ crApplicable: v })} />
      </Row>
      {value.crApplicable && (
        <>
          <Row label="Max CRs per month" indent>
            {readOnly ? (
              <span className="text-sm text-foreground">{value.crMaxPerMonth === '' ? 'No limit' : value.crMaxPerMonth}</span>
            ) : (
              <input type="number" min={0} step={1} inputMode="numeric" placeholder="No limit" className={numberBox}
                value={value.crMaxPerMonth}
                onChange={(e) => onChange({ crMaxPerMonth: e.target.value === '' ? '' : Math.max(0, Math.trunc(Number(e.target.value))) })} />
            )}
          </Row>
          <Row label="Max hours per CR" hint="a CR above this is chargeable" indent>
            {readOnly ? (
              <span className="text-sm text-foreground">{value.crMaxHours === '' ? 'Not set' : `${value.crMaxHours} h`}</span>
            ) : (
              <input type="number" min={0} step="0.5" inputMode="decimal" placeholder="Hours" className={numberBox}
                value={value.crMaxHours}
                onChange={(e) => onChange({ crMaxHours: e.target.value === '' ? '' : Math.max(0, Number(e.target.value)) })} />
            )}
          </Row>
        </>
      )}
    </div>
  );
}
