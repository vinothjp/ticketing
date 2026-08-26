/**
 * Which clock an SLA target is measured against: round-the-clock calendar time,
 * or the tenant's working hours. Shared by the DTOs so both doors validate the
 * same list; the frontend mirrors it in `pages/SlaPolicyPage.tsx`.
 */
export const OPERATIONAL_HOURS = ['CALENDAR', 'BUSINESS'] as const;

export const OPERATIONAL_HOURS_LABELS: Record<string, string> = {
  CALENDAR: 'Calendar hours',
  BUSINESS: 'Business hours',
};
