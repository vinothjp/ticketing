import { ChevronDown } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export interface MultiCheckOption { value: string; label: string }

/**
 * A dropdown of checkboxes: pick any number of values from a list. The trigger
 * reads like a Select (the picked labels, or `emptyLabel` when none), and the
 * menu stays open while boxes are ticked. A picked value that is no longer among
 * `options` (renamed or deactivated since) is still listed, so it can be unticked
 * rather than silently kept.
 */
export default function MultiCheckSelect({
  options, value, onChange, emptyLabel = 'None selected', disabled, className,
}: {
  options: MultiCheckOption[];
  value: string[];
  onChange: (next: string[]) => void;
  emptyLabel?: string;
  disabled?: boolean;
  className?: string;
}) {
  const known = new Set(options.map((o) => o.value));
  const all = [...options, ...value.filter((v) => !known.has(v)).map((v) => ({ value: v, label: v }))];
  const labelOf = (v: string) => all.find((o) => o.value === v)?.label ?? v;
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  const text = value.length ? value.map(labelOf).join(', ') : emptyLabel;

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          className={cn(
            'flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 text-left text-sm shadow-xs',
            'disabled:cursor-not-allowed disabled:opacity-50',
            className,
          )}
        >
          <span className={cn('truncate', !value.length && 'text-muted-foreground')} title={text}>{text}</span>
          <ChevronDown className="size-4 shrink-0 opacity-50" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-64 w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto">
        {all.length === 0 && <div className="px-2 py-1.5 text-sm text-muted-foreground">No values in this list</div>}
        {all.map((o) => (
          <DropdownMenuCheckboxItem
            key={o.value}
            checked={value.includes(o.value)}
            onCheckedChange={() => toggle(o.value)}
            onSelect={(e) => e.preventDefault()}
          >
            {o.label}
          </DropdownMenuCheckboxItem>
        ))}
        {value.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onChange([])} className="text-muted-foreground">Clear selection</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
