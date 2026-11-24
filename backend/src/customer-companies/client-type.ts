/**
 * What a client bought. Its own file so services outside this module (CR limits,
 * client visits) can import it without a module cycle — see tasks/task-status.ts.
 *
 * AMC            = implementation + a support contract: every contract screen,
 *                  pool, reminder and renewal works as it always has.
 * IMPLEMENTATION, INTEGRATION, JOB_WORK
 *                = services only. No contract scope, coverage, terms, support-hours
 *                  pool, visits allowance, reminders or renewals. Contract services
 *                  (CR applicable and its limits) still apply, read at client level.
 *                  Every check asks "is this AMC?", never "is this Implementation?",
 *                  so a services-only type added here behaves the same everywhere.
 */
export const CLIENT_TYPES = ['IMPLEMENTATION', 'INTEGRATION', 'JOB_WORK', 'AMC'] as const;
export type ClientType = (typeof CLIENT_TYPES)[number];

export const CLIENT_TYPE_LABELS: Record<ClientType, string> = {
  IMPLEMENTATION: 'Implementation',
  INTEGRATION: 'Integration',
  JOB_WORK: 'Job Work',
  AMC: 'AMC',
};

/** Services only — every type but AMC. A missing type is a pre-existing client, i.e. AMC. */
export const isServicesOnly = (c: { clientType?: string | null } | null | undefined) =>
  (c?.clientType ?? 'AMC') !== 'AMC';
