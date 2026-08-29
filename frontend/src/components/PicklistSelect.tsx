import { useQuery } from '@tanstack/react-query';
import { optionListQuery } from '@/lib/optionLists';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const NONE = '__none__';

/**
 * A dropdown bound to a picklist-backed option list (`/admin/options`). The
 * `PicklistOption` twin of the CR module's `OptionSelect`, which reads the
 * change-request store instead.
 *
 * Two behaviours carry the weight:
 *  - empty maps to the `__none__` sentinel, because Radix `Select` cannot hold
 *    an empty value; and
 *  - a stored value that is not in the active list is still rendered as an
 *    option, so a record written before a value was renamed or deactivated is
 *    shown rather than silently blanked. Without that, Radix treats the value as
 *    unmatched, resets it and fires `onValueChange('')` — which would quietly
 *    wipe the field on the next save.
 */
export default function PicklistSelect({
  listKey, value, onChange, placeholder = 'None', className = 'w-full', disabled, id,
}: {
  listKey: string;
  value?: string | null;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  id?: string;
}) {
  const { data: opts = [] } = useQuery(optionListQuery(listKey));
  const active = opts.filter((o) => o.isActive).sort((a, b) => a.sortOrder - b.sortOrder);
  const known = new Set(active.map((o) => o.value));
  const current = value ?? '';
  return (
    <Select
      value={current || NONE}
      onValueChange={(v) => onChange(v === NONE ? '' : v)}
      disabled={disabled}
    >
      <SelectTrigger id={id} className={`${className} [&>span]:min-w-0 [&>span]:truncate`}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{placeholder}</SelectItem>
        {current && !known.has(current) && <SelectItem value={current}>{current}</SelectItem>}
        {active.map((o) => <SelectItem key={o.id} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
