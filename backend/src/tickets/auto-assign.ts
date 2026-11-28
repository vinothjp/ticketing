// Ticket auto-assignment vocabulary and rules — a plain file so TicketsService,
// ProductsService, CustomerProductsService and ClientsService can share it
// without a module cycle (the same reason tasks/task-status.ts exists).

/** The issue types a ticket can carry. Stored on `Ticket.consultantType`. */
export const ISSUE_TYPES = ['TECHNICAL', 'FUNCTIONAL', 'OTHERS'] as const;
export type IssueType = (typeof ISSUE_TYPES)[number];

export const ISSUE_TYPE_LABELS: Record<IssueType, string> = {
  TECHNICAL: 'Technical',
  FUNCTIONAL: 'Functional',
  OTHERS: 'Other',
};

export const isIssueType = (v: unknown): v is IssueType =>
  typeof v === 'string' && (ISSUE_TYPES as readonly string[]).includes(v);

/** Display label for a stored issue type; null when there is none. */
export const issueTypeLabel = (v?: string | null): string | null =>
  isIssueType(v) ? ISSUE_TYPE_LABELS[v] : null;

/** A module or product with no tracks set offers these. */
export const DEFAULT_TRACKS: IssueType[] = ['TECHNICAL', 'FUNCTIONAL'];

/** The issue types a module / product offers, in display order. */
export const offeredIssueTypes = (tracks: string[]): IssueType[] => {
  const own = ISSUE_TYPES.filter((t) => tracks.includes(t));
  return own.length ? own : DEFAULT_TRACKS;
};

/**
 * The issue type a ticket routes on: the one the person picked, else the
 * organization's default — but never a type the product/module doesn't offer
 * (client request): then its only type, else Technical, else its first.
 */
export function routingIssueType(picked: string | null | undefined, orgDefault: string, offered: IssueType[]): IssueType {
  const wanted: IssueType = isIssueType(picked) ? picked : isIssueType(orgDefault) ? orgDefault : 'TECHNICAL';
  if (offered.includes(wanted)) return wanted;
  if (offered.length === 1) return offered[0];
  return offered.includes('TECHNICAL') ? 'TECHNICAL' : offered[0] ?? wanted;
}

/**
 * Statuses in which a ticket does NOT count towards its agent's load (client
 * request), matched on the tenant's picklist **label**, lower-cased. Any other
 * status — Open, Reopened, In Progress, Assigned, or one added or renamed
 * later — counts as holding the agent.
 */
export const FREE_STATUS_LABELS = [
  'on hold',
  'awaiting vendor update',
  'awaiting end-user response',
  'approval pending',
  'resolved',
  'closed',
  'rejected',
];

/**
 * Picks the agent for one routing step: of `candidates` (already in priority
 * order — primary first, then list order), the active one holding the fewest
 * open tickets below `max` (null = no limit). A tie goes to the earlier one,
 * so with everyone on zero the primary takes it. Null when nobody qualifies.
 */
export function pickLeastLoaded(
  candidates: string[],
  load: (userId: string) => number,
  isActive: (userId: string) => boolean,
  max: number | null,
): string | null {
  let best: string | null = null;
  let bestLoad = Infinity;
  const seen = new Set<string>();
  for (const id of candidates) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (!isActive(id)) continue;
    const n = load(id);
    if (max !== null && n >= max) continue;
    if (n < bestLoad) { best = id; bestLoad = n; }
  }
  return best;
}

/** One routing step's choice, given the step's candidates in priority order. */
export type AgentPicker = (candidates: string[]) => string | null;
