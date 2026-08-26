import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * A small panel anchored to a control inside a grid cell.
 *
 * The panel is portalled to <body> with fixed positioning, the same trick
 * `ConsultantGrid`'s agent type-ahead uses: a table scrolls under
 * `overflow-x-auto`, which would otherwise clip anything opening out of a cell.
 * It flips above the anchor when there is no room below and follows the cell on
 * scroll and resize.
 *
 * Deliberately hand-rolled rather than built on `DropdownMenu`: Radix's menu
 * type-ahead swallows keystrokes, and every popover here holds a text input.
 */
export function CellPopover({
  trigger,
  children,
  width = 320,
  /** Which edge lines up with the anchor's — `end` keeps a right-hand cell on screen. */
  align = 'end',
  /** Rough panel height, used only to decide whether to flip up. */
  estimatedHeight = 280,
}: {
  trigger: (opts: { open: boolean; toggle: () => void }) => ReactNode;
  children: (close: () => void) => ReactNode;
  width?: number;
  align?: 'start' | 'end';
  estimatedHeight?: number;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = () => setOpen(false);

  useLayoutEffect(() => {
    if (!open) return;

    const reposition = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const below = window.innerHeight - r.bottom;
      const openUp = below < estimatedHeight + 8 && r.top > below;
      // Keep the panel inside the viewport even when the cell sits at an edge.
      const raw = align === 'end' ? r.right - width : r.left;
      const left = Math.max(8, Math.min(raw, window.innerWidth - width - 8));
      setPos(openUp
        ? { left, bottom: window.innerHeight - r.top + 4 }
        : { left, top: r.bottom + 4 });
    };
    reposition();

    // The panel lives outside the anchor's DOM subtree, so an outside-click test
    // has to clear both — checking the anchor alone would close the popover the
    // moment you clicked into its own input.
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };

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
  }, [open, width, align, estimatedHeight]);

  return (
    <div ref={anchorRef} className="relative inline-block">
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && pos && createPortal(
        <div
          ref={panelRef}
          style={{ position: 'fixed', left: pos.left, top: pos.top, bottom: pos.bottom, width, zIndex: 50 }}
          className="rounded-md border bg-popover p-3 text-popover-foreground shadow-md"
        >
          {children(close)}
        </div>,
        document.body,
      )}
    </div>
  );
}
