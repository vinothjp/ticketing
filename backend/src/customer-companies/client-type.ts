/**
 * What a client bought. Its own file so services outside this module (CR limits,
 * client visits) can import it without a module cycle — see tasks/task-status.ts.
 *
 * AMC            = implementation + a support contract: every contract screen,
 *                  pool, reminder and renewal works as it always has.
 * IMPLEMENTATION = services only. No contract scope, coverage, terms, support-hours
 *                  pool, visits allowance, reminders or renewals. Contract services
 *                  (CR applicable and its limits) still apply, read at client level.
 */
export const CLIENT_TYPES = ['IMPLEMENTATION', 'AMC'] as const;
export type ClientType = (typeof CLIENT_TYPES)[number];

export const CLIENT_TYPE_LABELS: Record<ClientType, string> = {
  IMPLEMENTATION: 'Implementation',
  AMC: 'AMC',
};

export const isImplementation = (c: { clientType?: string | null } | null | undefined) =>
  c?.clientType === 'IMPLEMENTATION';
