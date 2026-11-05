// Reading a tenant's option list from a screen.
//
// Values live in the picklist store and are managed on the Option List screen
// (`/admin/options`). Anything that used to hard-code a dropdown array reads it
// through here instead, passing the array it replaced as `fallback` — a tenant
// that has emptied or deactivated the whole list still gets a usable form, and
// the options are never briefly empty while the query is in flight (an empty
// option set is what makes a controlled Radix `Select` drop its saved value).
import { useQuery } from '@tanstack/react-query';
import api from './api';

export interface PicklistValue {
  id: string;
  listKey: string;
  value: string;
  label: string;
  parentValue?: string | null;
  isActive: boolean;
  sortOrder: number;
}

export const optionListQuery = (listKey: string) => ({
  queryKey: ['picklist-options', listKey],
  queryFn: async () =>
    (await api.get('/api/picklist-options', { params: { listKey } })).data as PicklistValue[],
});

/** The list's active values, in admin order; `fallback` until it has any. */
export function useOptionValues(listKey: string, fallback: readonly string[] = []): string[] {
  const { data = [] } = useQuery(optionListQuery(listKey));
  const values = data
    .filter((o) => o.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((o) => o.value);
  return values.length ? values : [...fallback];
}
