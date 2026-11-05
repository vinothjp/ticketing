import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, Ticket, Building2, Boxes, ListTree, Loader2 } from 'lucide-react';
import api from '../lib/api';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type HitType = 'ticket' | 'client' | 'product' | 'module';
interface SearchHit {
  type: HitType;
  id: string;
  title: string;
  subtitle: string | null;
  to: string;
}

// Group order + labels. The backend already filters the types a viewer may see,
// so an empty group simply never renders.
const GROUPS: { type: HitType; label: string; icon: typeof Ticket }[] = [
  { type: 'ticket', label: 'Tickets', icon: Ticket },
  { type: 'client', label: 'Clients', icon: Building2 },
  { type: 'product', label: 'Products', icon: Boxes },
  { type: 'module', label: 'Modules', icon: ListTree },
];

/**
 * The header search box. Types at least two characters, waits out a 250ms
 * debounce, then lists tickets (by number or subject), clients, products and
 * modules; picking one navigates to its screen.
 */
export default function GlobalSearch() {
  const navigate = useNavigate();
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(term.trim()), 250);
    return () => clearTimeout(id);
  }, [term]);

  const enabled = debounced.length >= 2;
  const { data: hits = [], isFetching } = useQuery<SearchHit[]>({
    queryKey: ['global-search', debounced],
    queryFn: async () => (await api.get('/api/search', { params: { q: debounced } })).data,
    enabled,
    staleTime: 30_000,
  });

  // Flat, group-ordered list — what the arrow keys walk and Enter picks.
  const ordered = useMemo(
    () => GROUPS.flatMap((g) => hits.filter((h) => h.type === g.type)),
    [hits],
  );
  // Held rather than derived, so it survives a refetch; clamped here because a
  // narrower result set can leave it past the end.
  const activeIndex = ordered.length ? Math.min(active, ordered.length - 1) : 0;

  // Click outside closes the panel.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  function go(hit: SearchHit) {
    setOpen(false);
    setTerm('');
    setDebounced('');
    navigate(hit.to);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (!ordered.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (Math.min(i, ordered.length - 1) + 1) % ordered.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (Math.min(i, ordered.length - 1) - 1 + ordered.length) % ordered.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(ordered[activeIndex] ?? ordered[0]);
    }
  }

  const showPanel = open && enabled;

  return (
    <div ref={boxRef} className="relative w-full max-w-xs">
      <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={term}
        onChange={(e) => {
          setTerm(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Search tickets, clients, modules..."
        className="pl-8"
      />
      {isFetching && (
        <Loader2 className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
      )}

      {showPanel && (
        <div className="absolute top-full left-0 z-50 mt-1 max-h-96 w-[22rem] overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg">
          {ordered.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              {isFetching ? 'Searching…' : `No matches for “${debounced}”`}
            </div>
          ) : (
            GROUPS.map((group) => {
              const rows = hits.filter((h) => h.type === group.type);
              if (!rows.length) return null;
              const Icon = group.icon;
              return (
                <div key={group.type}>
                  <div className="px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                    {group.label}
                  </div>
                  {rows.map((hit) => {
                    // Position in the flat, group-ordered list — what the arrows track.
                    const i = ordered.indexOf(hit);
                    return (
                      <button
                        key={`${hit.type}-${hit.id}`}
                        type="button"
                        onMouseEnter={() => setActive(i)}
                        onClick={() => go(hit)}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left',
                          i === activeIndex && 'bg-accent',
                        )}
                      >
                        <Icon className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0">
                          <span className="block truncate text-sm text-foreground" title={hit.title}>
                            {hit.title}
                          </span>
                          {hit.subtitle && (
                            <span className="block truncate text-xs text-muted-foreground">
                              {hit.subtitle}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
