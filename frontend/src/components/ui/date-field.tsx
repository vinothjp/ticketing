import { useEffect, useMemo, useRef, useState } from 'react';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';

// A controlled date picker whose out-of-range days are greyed out and un-clickable.
// value/onChange use "YYYY-MM-DD"; min/max are inclusive "YYYY-MM-DD" bounds.

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parse = (v?: string) => { if (!v) return null; const [y, m, d] = v.split('-').map(Number); return new Date(y, m - 1, d); };
const WEEK = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

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
  const [dropUp, setDropUp] = useState(false);   // open the calendar above the field when there's no room below
  const [cursor, setCursor] = useState(() => parse(value) ?? parse(min) ?? new Date());
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setCursor(parse(value) ?? parse(min) ?? new Date());
    // Flip up if the ~330px calendar would overflow the viewport bottom (e.g. field near a dialog's edge).
    const r = ref.current?.getBoundingClientRect();
    if (r) setDropUp(r.bottom + 330 > window.innerHeight);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close on outside-click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

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
        <span className={label ? '' : 'text-muted-foreground'}>{label || placeholder}</span>
      </button>

      {open && (
        <div className={`absolute left-0 z-50 w-64 rounded-md border bg-popover p-2 text-popover-foreground shadow-md ${dropUp ? 'bottom-full mb-1' : 'top-full mt-1'}`}>
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
        </div>
      )}
    </div>
  );
}
