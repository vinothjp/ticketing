import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';

/** Mirrors backend `customer-companies/deployment-model.ts`. */
export const DEPLOYMENT_MODELS = [
  { value: 'PRIVATE_CLOUD', label: 'Private Cloud' },
  { value: 'PUBLIC_CLOUD', label: 'Public Cloud' },
  { value: 'ON_PREMISES', label: 'On-Premises' },
] as const;

/** Display label for a stored value; null when unset or unknown. */
export const deploymentModelLabel = (v?: string | null) =>
  DEPLOYMENT_MODELS.find((m) => m.value === v)?.label ?? null;

/** The deployment model is offered for SAP S/4HANA only (matched on the product name). */
export const hasDeploymentModel = (productName?: string | null) =>
  !!productName && /s\s*\/?\s*4\s*-?\s*hana/i.test(productName);

/**
 * How the client runs this product. Saves on pick. The RadioGroup is the
 * hand-rolled one and fires on every click, so a re-pick is ignored here.
 */
export default function DeploymentModelChoice({
  value, onChange, disabled, className,
}: { value: string | null; onChange: (v: string) => void; disabled?: boolean; className?: string }) {
  return (
    // The label stays on the options' line, like Support hours; the three
    // options sit beside it on one row, wrapping only when narrow (ECC was
    // dropped by client request, which left a 2×2 grid with a stranded cell).
    <div className={cn('flex items-start gap-x-5', className)}>
      <span className="shrink-0 whitespace-nowrap text-sm font-medium text-foreground">Deployment model</span>
      <RadioGroup value={value ?? ''} disabled={disabled}
        onValueChange={(v) => { if (v && v !== value) onChange(v); }}
        className="flex min-w-0 flex-wrap gap-x-8 gap-y-1.5">
        {DEPLOYMENT_MODELS.map((m) => (
          <label key={m.value} className="flex items-center gap-2 text-sm"><RadioGroupItem value={m.value} /> {m.label}</label>
        ))}
      </RadioGroup>
    </div>
  );
}
