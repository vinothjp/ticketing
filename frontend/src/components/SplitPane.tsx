import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

const readStored = (key?: string) => {
  if (!key) return null;
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null; // private mode / storage disabled
  }
};

/**
 * Two columns split by a divider the user can drag left or right.
 *
 * The *right* column carries the explicit width and the left one takes whatever
 * is left, so a sticky panel on the right keeps a predictable size while the
 * content column flexes. Below `lg` a divider makes no sense — the columns
 * stack and the width is ignored.
 */
export default function SplitPane({
  left, right, storageKey, defaultRight = 288, minRight = 260, minLeft = 360, className,
}: {
  left: React.ReactNode;
  right: React.ReactNode;
  /** localStorage key the dragged width is remembered under. */
  storageKey?: string;
  defaultRight?: number;
  minRight?: number;
  minLeft?: number;
  className?: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(() => readStored(storageKey) ?? defaultRight);
  const [dragging, setDragging] = useState(false);
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 1024px)').matches);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const onChange = () => setWide(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Clamp against the live container, so the left column can never be squeezed
  // out however far the pointer travels.
  const clamp = useCallback((next: number) => {
    const box = wrap.current?.getBoundingClientRect();
    const max = box ? Math.max(minRight, box.width - minLeft) : next;
    return Math.min(max, Math.max(minRight, next));
  }, [minLeft, minRight]);

  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => {
      e.preventDefault();
      const box = wrap.current?.getBoundingClientRect();
      if (box) setWidth(clamp(box.right - e.clientX));
    };
    const up = () => setDragging(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [dragging, clamp]);

  // Remember the width once the drag settles, not on every pointer move.
  useEffect(() => {
    if (dragging || !storageKey) return;
    try { localStorage.setItem(storageKey, String(Math.round(width))); } catch { /* storage disabled */ }
  }, [dragging, width, storageKey]);

  if (!wide) {
    return <div className={cn('flex flex-col gap-4', className)}>{left}{right}</div>;
  }

  return (
    <div ref={wrap} className={cn('flex items-start', dragging && 'select-none', className)}>
      <div className="min-w-0 flex-1">{left}</div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize columns"
        aria-valuenow={Math.round(width)}
        tabIndex={0}
        onPointerDown={(e) => { e.preventDefault(); setDragging(true); }}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 48 : 16;
          if (e.key === 'ArrowLeft') { e.preventDefault(); setWidth((w) => clamp(w + step)); }
          if (e.key === 'ArrowRight') { e.preventDefault(); setWidth((w) => clamp(w - step)); }
        }}
        className={cn(
          'group relative mx-1.5 w-2 shrink-0 cursor-col-resize self-stretch rounded outline-none',
          'focus-visible:ring-2 focus-visible:ring-ring/50',
        )}
      >
        <span
          className={cn(
            'absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors',
            'group-hover:w-0.5 group-hover:bg-primary',
            dragging && 'w-0.5 bg-primary',
          )}
        />
        {/* Grip — without it the hairline reads as a plain rule, not a handle. */}
        <span className="absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col gap-0.5 rounded-full border bg-background px-0.5 py-1 shadow-sm">
          {[0, 1, 2].map((i) => <span key={i} className="size-0.5 rounded-full bg-muted-foreground" />)}
        </span>
      </div>
      {/* self-stretch, not the container's items-start, so a sticky panel in
          the right column has the full row height to travel in. */}
      <div style={{ width }} className="shrink-0 self-stretch">{right}</div>
    </div>
  );
}
