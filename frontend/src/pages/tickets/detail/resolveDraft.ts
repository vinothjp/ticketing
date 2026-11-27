// Kept apart from ResolutionTab.tsx so that file exports only components (fast refresh).

/**
 * The resolution being written, held by the ticket screen (not here) so it is
 * part of the ticket's draft: **Resolve** only stages it, and the header's
 * **Save** books the time and resolves (client request — no auto-save).
 * `staged`: null = just typing; 'new' = book notes + hours, then resolve;
 * 'entry' = this round's entry already exists, resolve on its notes.
 */
export interface ResolveDraft {
  notes: string;
  hours: string;
  staged: null | 'new' | 'entry';
  entryNote?: string;
}
export const EMPTY_RESOLVE: ResolveDraft = { notes: '', hours: '', staged: null };
