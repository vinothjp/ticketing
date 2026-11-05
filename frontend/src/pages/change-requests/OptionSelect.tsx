import { useQuery } from '@tanstack/react-query';
import api from '../../lib/api';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { crOptionsQuery } from './changeRequestMeta';

const NONE = '__none__';

// A dropdown bound to a CR option list. Empty maps to the __none__ sentinel
// (Radix Select can't hold an empty value). A stored value that is no longer in
// the active list is still shown so it isn't silently dropped.
export function OptionSelect({
  listKey, value, onChange, placeholder = 'None', className = 'w-full', disabled, parent,
}: {
  listKey: string;
  value?: string | null;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  // Dependent lists (e.g. subcategory): when provided, restrict options to those
  // whose parentValue matches the chosen parent value.
  parent?: string | null;
}) {
  const { data: opts = [] } = useQuery(crOptionsQuery(listKey));
  const active = opts
    .filter((o) => o.isActive)
    .filter((o) => (parent === undefined ? true : (o.parentValue ?? '') === (parent ?? '')));
  const known = new Set(active.map((o) => o.value));
  const current = value ?? '';
  return (
    <Select value={current || NONE} onValueChange={(v) => onChange(v === NONE ? '' : v)} disabled={disabled}>
      <SelectTrigger className={className}><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{placeholder}</SelectItem>
        {current && !known.has(current) && <SelectItem value={current}>{current}</SelectItem>}
        {active.map((o) => <SelectItem key={o.id} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/**
 * The CR fields that name a record the app already owns — a user, a project, a
 * product module — read from the real thing, never from an editable option list.
 * A list of typed-in names would be a second, drifting copy of a screen that
 * already manages those records, and a value added to it could never become the
 * user/project/module it is pretending to be.
 *
 * The stored value is still the display name, exactly as when these came from an
 * option list, so existing change requests read back unchanged; a stored name
 * that no longer matches a live record is kept as an option so it is not
 * silently dropped.
 */
export type EntitySource = 'person' | 'project' | 'module';

const ENTITY_QUERIES: Record<EntitySource, { queryKey: unknown[]; queryFn: () => Promise<string[]> }> = {
  // Staff users; `/api/users` already excludes customer contacts.
  person: {
    queryKey: ['cr-entities', 'person'],
    queryFn: async () => {
      const users = (await api.get('/api/users')).data as {
        username: string; name?: string | null; isActive: boolean;
      }[];
      return users.filter((u) => u.isActive).map((u) => u.name?.trim() || u.username);
    },
  },
  project: {
    queryKey: ['cr-entities', 'project'],
    queryFn: async () => {
      const projects = (await api.get('/api/projects')).data as { name: string }[];
      return projects.map((p) => p.name);
    },
  },
  // Every product module the tenant has defined, flattened across products.
  module: {
    queryKey: ['cr-entities', 'module'],
    queryFn: async () => {
      const products = (await api.get('/api/products')).data as {
        modules?: { name: string }[];
      }[];
      return products.flatMap((p) => (p.modules ?? []).map((m) => m.name));
    },
  },
};

export function EntitySelect({
  source, value, onChange, placeholder = 'None', className = 'w-full', disabled,
}: {
  source: EntitySource;
  value?: string | null;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) {
  const { data = [] } = useQuery(ENTITY_QUERIES[source]);
  const names = [...new Set(data.filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const current = value ?? '';
  return (
    <Select value={current || NONE} onValueChange={(v) => onChange(v === NONE ? '' : v)} disabled={disabled}>
      <SelectTrigger className={className}><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{placeholder}</SelectItem>
        {current && !names.includes(current) && <SelectItem value={current}>{current}</SelectItem>}
        {names.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
