import { useQuery } from '@tanstack/react-query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { crOptionsQuery } from './changeRequestMeta';

const NONE = '__none__';

// A dropdown bound to a CR option list. Empty maps to the __none__ sentinel
// (Radix Select can't hold an empty value). A stored value that is no longer in
// the active list is still shown so it isn't silently dropped.
export function OptionSelect({
  listKey, value, onChange, placeholder = 'None', className = 'w-full', disabled,
}: {
  listKey: string;
  value?: string | null;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) {
  const { data: opts = [] } = useQuery(crOptionsQuery(listKey));
  const active = opts.filter((o) => o.isActive);
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
