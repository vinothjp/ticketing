import { useState, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Star } from 'lucide-react';

// Module × Technical / Functional / Others grid for assigning a client's per-product
// consultants. "Others" maps to no specific track (module-wide fallback).
const CCOLS = [
  { key: 'TECHNICAL', label: 'Technical' },
  { key: 'FUNCTIONAL', label: 'Functional' },
  { key: 'OTHERS', label: 'Others' },
] as const;

export interface GridModule { id: string; name: string }
export interface GridConsultant { id: string; userId: string; username: string | null; moduleId: string | null; track: string | null; isPrimary?: boolean }
interface StaffUser { id: string; username: string }

export default function ConsultantGrid({ modules, consultants, staff, onAdd, onRemove, onPrimary, emptyRowLabel = 'Whole product', readOnly = false }: {
  modules: GridModule[];
  consultants: GridConsultant[];
  staff: StaffUser[];
  onAdd: (moduleId: string | null, col: string, userId: string) => void;
  onRemove: (id: string) => void;
  onPrimary?: (id: string) => void;
  emptyRowLabel?: string;
  /** Consultants read the client screens but may not change routing on them. */
  readOnly?: boolean;
}) {
  // One row per module when split into modules; otherwise a single catch-all row.
  const rows = modules.length > 0
    ? modules.map((m) => ({ key: m.id, name: m.name, moduleId: m.id as string | null }))
    : [{ key: '__product', name: emptyRowLabel, moduleId: null as string | null }];
  const inCell = (moduleId: string | null, colKey: string) =>
    consultants.filter((c) => c.moduleId === moduleId && (
      colKey === 'TECHNICAL' ? c.track === 'TECHNICAL'
      : colKey === 'FUNCTIONAL' ? c.track === 'FUNCTIONAL'
      : c.track !== 'TECHNICAL' && c.track !== 'FUNCTIONAL'));

  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-muted/50 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <th className="w-44 border-b px-3 py-2">Module</th>
            {CCOLS.map((c) => <th key={c.key} className="border-b border-l px-3 py-2">{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="align-top">
              <td className="border-b px-3 py-2 font-medium text-foreground">{row.name}</td>
              {CCOLS.map((c) => {
                const list = inCell(row.moduleId, c.key).slice().sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
                const taken = new Set(list.map((a) => a.userId));
                return (
                  <td key={c.key} className="border-b border-l px-2 py-2 align-top">
                    <div className="space-y-1">
                      {list.map((a) => (
                        <div key={a.id} className="group flex items-center gap-1 rounded bg-muted px-1.5 py-1 text-xs">
                          {a.isPrimary
                            ? <Star className="size-3 shrink-0 fill-amber-500 text-amber-500" />
                            : readOnly ? null
                            : <button title="Make primary" className="shrink-0 text-muted-foreground hover:text-amber-500" onClick={() => onPrimary?.(a.id)}><Star className="size-3" /></button>}
                          <span className="flex-1 truncate text-foreground">{a.username}</span>
                          {!readOnly && <button className="shrink-0 text-muted-foreground hover:text-destructive" onClick={() => onRemove(a.id)}><X className="size-3" /></button>}
                        </div>
                      ))}
                      {!readOnly && <ConsultantTypeahead staff={staff} exclude={taken} onPick={(uid) => onAdd(row.moduleId, c.key, uid)} />}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Type-to-search agent picker for a grid cell. The dropdown is portalled to
// <body> with fixed positioning so it isn't clipped by the table's overflow.
function ConsultantTypeahead({ staff, exclude, onPick }: { staff: StaffUser[]; exclude: Set<string>; onPick: (userId: string) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number } | null>(null);
  const matches = staff.filter((u) => !exclude.has(u.id) && u.username.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 8);

  const reposition = () => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const DROP_H = 200; // ~max-h-48 + padding
    const below = window.innerHeight - r.bottom;
    const openUp = below < DROP_H + 8 && r.top > below; // flip up when it wouldn't fit below
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
  }, [open, q]);

  return (
    <div className="relative">
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="+ type agent…"
        className="h-7 w-full rounded border border-input bg-background px-2 text-xs outline-none focus:border-primary"
      />
      {open && matches.length > 0 && pos && createPortal(
        <div
          style={{ position: 'fixed', left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.width, zIndex: 50 }}
          className="max-h-48 min-w-36 overflow-y-auto rounded-md border bg-popover shadow-md">
          {matches.map((u) => (
            <button key={u.id} className="block w-full truncate px-2 py-1.5 text-left text-xs hover:bg-muted" onMouseDown={(e) => { e.preventDefault(); onPick(u.id); setQ(''); }}>
              {u.username}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
