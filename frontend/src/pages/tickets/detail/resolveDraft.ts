// Kept apart from ResolutionTab.tsx so that file exports only components (fast refresh).

/**
 * The resolution being typed, held by the ticket screen (not here) so switching
 * tabs keeps it and the header's Discard clears it. **Resolve** acts at once:
 * it books the time and resolves the ticket in one click (client request).
 */
export interface ResolveDraft {
  notes: string;
  hours: string;
}
export const EMPTY_RESOLVE: ResolveDraft = { notes: '', hours: '' };
