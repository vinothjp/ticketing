/**
 * The per-client module switch on a client's product screen. A product with
 * modules counts as inactive for that client once every one of its modules is
 * switched off, and becomes active again as soon as any one is switched back on
 * — derived, never stored, so it can't drift from the switches. An unsplit
 * product (no modules) has nothing to switch and is always active.
 *
 * Plain functions in their own file so `TicketsService` and
 * `CustomerCompaniesService` can share the rule without a module import.
 */
export function productOffForClient(moduleIds: string[], inactiveModuleIds: string[]): boolean {
  return moduleIds.length > 0 && moduleIds.every((id) => inactiveModuleIds.includes(id));
}
