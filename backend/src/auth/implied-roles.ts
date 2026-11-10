/**
 * Roles that carry another role's rights.
 *
 * A `Manager` holds every right an agent (`Viewer`) has, without `Viewer` being
 * stored on the user: a user saved with Manager alone stays Manager alone on the
 * Users screen. `RolesGuard` matches against the expanded set, so every
 * `@Roles('Viewer')` route admits a Manager; the frontend's `isStaff` checks
 * accept `Manager` the same way.
 */
export const IMPLIED_ROLES: Record<string, string[]> = {
  Manager: ['Viewer'],
};

/** A role-name list with every implied role added, order kept, no duplicates. */
export function withImpliedRoles(roles: string[] | undefined | null): string[] {
  const out = [...(roles ?? [])];
  for (const role of roles ?? []) {
    for (const implied of IMPLIED_ROLES[role] ?? []) {
      if (!out.includes(implied)) out.push(implied);
    }
  }
  return out;
}
