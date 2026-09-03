import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';

export interface ComboboxOption {
  value: string;
  label: string;
  /** Secondary text — searched like the label, shown muted beside it. */
  hint?: string | null;
}

/**
 * A dropdown you can also type into. It behaves as a plain select — click it and
 * the whole list drops — but a query narrows the list as you go, which is what a
 * register of hundreds of assets needs and what a Radix `Select` cannot do.
 *
 * Not built on Radix: its `Select` has no filter, and its portalled content does
 * not surface to the automation tooling in this environment. The list is
 * portalled to <body> with fixed positioning (the same trick `ConsultantGrid`'s
 * type-ahead uses) so a dialog's `overflow-y-auto` cannot clip it, and it flips
 * up when there is no room below.
 */
export function Combobox({
  value,
  options,
  onChange,
  placeholder = 'Select…',
  emptyText = 'No matches',
  disabled = false,
  className = '',
}: {
  value: string;
  options: ComboboxOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number } | null>(null);

  const selected = options.find((o) => o.value === value) ?? null;
  const q = query.trim().toLowerCase();
  // An empty query lists everything: opening the box has to feel like opening a
  // dropdown, not like an empty search.
  const matches = q
    ? options.filter((o) => `${o.label} ${o.hint ?? ''}`.toLowerCase().includes(q))
    : options;

  const reposition = () => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const DROP_H = 240;
    const below = window.innerHeight - r.bottom;
    const openUp = below < DROP_H + 8 && r.top > below;
    setPos(openUp
      ? { left: r.left, width: r.width, bottom: window.innerHeight - r.top + 4 }
      : { left: r.left, width: r.width, top: r.bottom + 4 });
  };
  useLayoutEffect(() => {
    if (!open) return;
    reposition();
    const h = () => reposition();
    window.addEventListener('scroll', h, true);
    window.addEventListener('resize', h);
    return () => { window.removeEventListener('scroll', h, true); window.removeEventListener('resize', h); };
  }, [open, query, matches.length]);

  // Arrowing past the fold has to bring the row with it.
  useLayoutEffect(() => {
    if (open) activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const show = () => { if (disabled) return; setQuery(''); setActive(0); setOpen(true); };
  const close = () => { setOpen(false); setQuery(''); };
  const pick = (v: string) => { onChange(v); close(); inputRef.current?.blur(); };

  return (
    <div className={`relative ${className}`}>
      <input
        ref={inputRef}
        // Closed, it reads as the current selection; open, it is the search box.
        value={open ? query : selected?.label ?? ''}
        placeholder={selected ? selected.label : placeholder}
        disabled={disabled}
        onChange={(e) => { setQuery(e.target.value); setActive(0); setOpen(true); }}
        onFocus={show}
        onMouseDown={() => { if (!open) show(); }}
        // A click on an option is a mousedown on the list, which blurs first —
        // hence the delay, the same one the consultant type-ahead uses.
        onBlur={() => setTimeout(close, 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!open) { show(); return; }
            setActive((i) => {
              const next = e.key === 'ArrowDown' ? i + 1 : i - 1;
              return Math.min(Math.max(next, 0), Math.max(matches.length - 1, 0));
            });
          } else if (e.key === 'Enter') {
            if (open && matches[active]) { e.preventDefault(); pick(matches[active].value); }
          } else if (e.key === 'Escape') {
            if (open) { e.preventDefault(); close(); }
          }
        }}
        className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 pr-8 text-sm shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
      />
      <ChevronDown
        className={`pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
      />

      {open && pos && createPortal(
        <div
          // Two things a body-level portal has to undo to work inside a Radix
          // dialog. `pointerEvents: 'auto'` — an open modal sets
          // `pointer-events: none` on <body> and hands them back only to its own
          // layer, so a list portalled beside it is inert (it renders, hovers
          // nothing, clicks nothing). And the pointerdown is stopped here so it
          // never reaches the document listener that reads a click outside the
          // dialog as "dismiss" and closes the whole thing under the cursor.
          style={{
            position: 'fixed', left: pos.left, top: pos.top, bottom: pos.bottom,
            width: pos.width, zIndex: 60, pointerEvents: 'auto',
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.preventDefault()}
          // And the dialog's scroll lock cancels any wheel whose target is
          // outside its layer, which would leave this list unable to scroll.
          // Both its listener and the dismiss one sit on `document` in the
          // bubble phase, so stopping the event at the list is enough — React
          // delegates portal events on <body>, one hop below.
          onWheel={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
          className="max-h-60 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {matches.length === 0 ? (
            <div className="px-2 py-1.5 text-sm text-muted-foreground">{emptyText}</div>
          ) : matches.map((o, i) => (
            <button
              key={o.value}
              type="button"
              ref={i === active ? activeRef : undefined}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => { e.preventDefault(); pick(o.value); }}
              className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm ${
                i === active ? 'bg-accent text-accent-foreground' : ''
              } ${o.value === value ? 'font-medium' : ''}`}
            >
              <span className="truncate">{o.label}</span>
              {o.hint && <span className="ml-auto shrink-0 text-xs text-muted-foreground">{o.hint}</span>}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

export default Combobox;
