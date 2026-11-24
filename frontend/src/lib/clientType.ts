/**
 * What a client bought — mirrors backend `customer-companies/client-type.ts`.
 * Every type but AMC is services only (no contract, terms, pool or renewals),
 * so screens ask `isServicesOnly`, never "is this Implementation?".
 */
export type ClientType = 'IMPLEMENTATION' | 'INTEGRATION' | 'JOB_WORK' | 'AMC';

export const CLIENT_TYPE_OPTIONS: { value: ClientType; label: string }[] = [
  { value: 'IMPLEMENTATION', label: 'Implementation' },
  { value: 'INTEGRATION', label: 'Integration' },
  { value: 'JOB_WORK', label: 'Job Work' },
  { value: 'AMC', label: 'AMC' },
];

export const clientTypeLabel = (t?: string | null) =>
  CLIENT_TYPE_OPTIONS.find((o) => o.value === t)?.label ?? 'AMC';

/** True only for a known non-AMC type; an unloaded record is not services-only. */
export const isServicesOnly = (t?: string | null) => !!t && t !== 'AMC';
