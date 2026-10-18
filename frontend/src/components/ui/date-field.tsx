import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';

// A controlled date picker whose out-of-range days are greyed out and un-clickable.
// value/onChange use "YYYY-MM-DD"; min/max are inclusive "YYYY-MM-DD" bounds.

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parse = (v?: string) => { if (!v) return null; const [y, m, d] = v.split('-').map(Number); return new Date(y, m - 1, d); };
const WEEK = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const PANEL_W = 256;   // w-64
const PANEL_H = 330;   // rough calendar height, used only to decide whether to flip up

export function DateField({
  value, onChange, min, max, disabled, placeholder = 'Pick a date', className = '',
}: {
  value?: string;
  onChange: (v: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const [cursor, setCursor] = useState(() => parse(value) ?? parse(min) ?? new Date());
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // The calendar is portalled to <body> with fixed positioning, like `CellPopover`:
  // a dialog scrolls its own body, so an absolutely-placed calendar was clipped by
  // it — in a short dialog there is room neither above nor below the field. It
  // flips above the field only when the viewport has no room below, stays inside
  // the viewport sideways, and follows the field on scroll and resize.
  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    setCursor(parse(value) ?? parse(min) ?? new Date());

    const reposition = () => {
      const r = ref.current?.getBoundingClientRect();
      if (!r) return;
      const below = window.innerHeight - r.bottom;
      const left = Math.max(8, Math.min(r.left, window.innerWidth - PANEL_W - 8));
      setPos(below < PANEL_H + 8 && r.top > below
        ? { left, bottom: window.innerHeight - r.top + 4 }
        : { left, top: r.bottom + 4 });
    };
    reposition();

    // The panel lives outside the field's DOM subtree, so an outside click has to
    // miss both — testing the field alone would close it before a day registers.
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const cells = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const start = new Date(first);
    start.setDate(first.getDate() - first.getDay());
    return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  }, [cursor]);

  const outOfRange = (d: Date) => !!((min && iso(d) < min) || (max && iso(d) > max));
  const label = value ? parse(value)!.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '';

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 w-full items-center gap-2 rounded-md border border-input bg-transparent px-3 text-left text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <CalendarIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className={`min-w-0 truncate whitespace-nowrap ${label ? '' : 'text-muted-foreground'}`}>{label || placeholder}</span>
      </button>

      {open && pos && createPortal(
        <div
          ref={panelRef}
          // `data-floating-panel` tells a surrounding Dialog that a click here is not
          // "outside" it; pointer-events is restored because a modal Radix dialog
          // switches it off on <body>; mousedown is cancelled so a day button never
          // takes focus away from the dialog's focus trap.
          data-floating-panel=""
          onMouseDown={(e) => e.preventDefault()}
          style={{ position: 'fixed', left: pos.left, top: pos.top, bottom: pos.bottom, width: PANEL_W, zIndex: 60, pointerEvents: 'auto' }}
          className="rounded-md border bg-popover p-2 text-popover-foreground shadow-md"
        >
          <div className="mb-1 flex items-center justify-between">
            <button type="button" className="rounded p-1 hover:bg-accent" onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))}><ChevronLeft className="size-4" /></button>
            <span className="text-sm font-medium">{cursor.toLocaleString(undefined, { month: 'long', year: 'numeric' })}</span>
            <button type="button" className="rounded p-1 hover:bg-accent" onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))}><ChevronRight className="size-4" /></button>
          </div>
          <div className="grid grid-cols-7 text-center text-[11px] text-muted-foreground">
            {WEEK.map((w) => <div key={w} className="py-1">{w}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((d, i) => {
              const inMonth = d.getMonth() === cursor.getMonth();
              const disabledDay = outOfRange(d);
              const selected = value === iso(d);
              return (
                <button
                  key={i}
                  type="button"
                  disabled={disabledDay}
                  onClick={() => { onChange(iso(d)); setOpen(false); }}
                  className={`size-8 rounded text-xs
                    ${selected ? 'bg-primary font-semibold text-primary-foreground' : ''}
                    ${disabledDay ? 'cursor-not-allowed text-muted-foreground/30' : inMonth ? 'hover:bg-accent' : 'text-muted-foreground/60 hover:bg-accent'}`}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
