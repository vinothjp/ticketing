import { cn } from '@/lib/utils';

/**
 * Hours as a whole number, for the coverage meters. A pool is summed from
 * worklogs entered in quarter-hours, so the arithmetic routinely lands on a
 * float that prints as `80.99000000000001` — and a contract meter is read at a
 * glance, not audited to the minute. Rounded rather than truncated, so the
 * figure is the nearest hour rather than always the pessimistic one.
 */
export const wholeHrs = (n: number | null | undefined) => Math.round(Number(n ?? 0));

/**
 * One read-only coverage row: what the pool is, how much of the term or
 * allocation has gone (the bar), and the remaining figure beneath it.
 *
 * `pct` is the share **consumed**, so the bar fills as the term runs down.
 * Shared by the per-product coverage panel (`ClientProductPage`) and the
 * shared customer contract (`ClientDetailPage`) so the two never drift apart.
 */
export default function CoverageMeter({ icon, title, subtitle, pct, active, right }: { icon: React.ReactNode; title: string; subtitle: string; pct: number; active: boolean; right?: string }) {
  const warn = active && pct >= 85;
  return (
    <div className="space-y-1.5 rounded-lg border p-3">
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-1.5 font-medium text-foreground">{icon} {title}</span>
        <span className={cn('text-xs', !active ? 'text-destructive' : warn ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground')}>{right ?? (active ? '' : 'Ended')}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full rounded-full', !active ? 'bg-destructive' : warn ? 'bg-amber-500' : 'bg-primary')} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <div className="text-xs text-muted-foreground">{subtitle}</div>
    </div>
  );
}
