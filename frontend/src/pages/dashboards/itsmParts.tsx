import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CalendarDays, ChevronDown, Check } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

/*
 * Building blocks shared by the two ITSM dashboards. Charts are hand-rolled SVG
 * (the app carries no chart library); every colour is passed in by the page, so
 * each dashboard keeps the exact palette sampled from its mockup.
 */

export const INK = '#0a1033';
export const MUTED = '#7884a2';
export const GRID = '#e8ecf5';

// ---------------------------------------------------------------- surfaces

export function Panel({
  title, icon, action, className, children, iconColor = '#14307a',
}: {
  title: string; icon: ReactNode; action?: ReactNode; className?: string; children: ReactNode; iconColor?: string;
}) {
  return (
    <section
      className={cn(
        'flex min-w-0 flex-col rounded-2xl border border-[#e3e8f4] bg-white p-5 shadow-[0_2px_12px_rgba(20,40,110,0.06)]',
        className,
      )}
    >
      <header className="mb-3 flex items-center justify-between gap-3">
        <h2 className="flex min-w-0 items-center gap-2.5 text-[15px] font-bold" style={{ color: INK }}>
          <span className="shrink-0 [&>svg]:size-5" style={{ color: iconColor }}>{icon}</span>
          <span className="truncate">{title}</span>
        </h2>
        {action}
      </header>
      {children}
    </section>
  );
}

export function PanelLink({ to, children, color = '#1763e9' }: { to: string; children: ReactNode; color?: string }) {
  return (
    <Link to={to} className="flex shrink-0 items-center gap-1 text-xs font-semibold hover:underline" style={{ color }}>
      {children} <ArrowRight className="size-3.5" />
    </Link>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-xl bg-[#e6eaf5]', className)} />;
}

export function Empty({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-1 items-center justify-center py-8 text-center text-sm', className)} style={{ color: MUTED }}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------- deltas & KPIs

/** ▲/▼ with a percentage; `unit` is '%' for a relative change, ' pts' style for an absolute one. */
export function Delta({
  value, upColor = '#0cac5d', downColor = '#eb4542', unit = '%', className,
}: { value: number | null; upColor?: string; downColor?: string; unit?: string; className?: string }) {
  if (value == null) return <span className={cn('text-xs font-semibold', className)} style={{ color: MUTED }}>—</span>;
  const up = value >= 0;
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-bold', className)} style={{ color: up ? upColor : downColor }}>
      <span className="text-[10px]">{up ? '▲' : '▼'}</span>
      {up ? '+' : ''}{value}{unit}
    </span>
  );
}

export interface KpiTone { bg: string; border: string; icon: string; iconBg?: string }

/**
 * One KPI tile. Dashboard 1 reads label → value → delta, Dashboard 2 value → label → delta,
 * hence `valueFirst`. The whole tile links to the list it counts.
 */
export function KpiCard({
  to, icon, label, value, delta, tone, valueFirst = false,
}: { to: string; icon: ReactNode; label: string; value: string; delta: ReactNode; tone: KpiTone; valueFirst?: boolean }) {
  return (
    <Link
      to={to}
      className="flex min-w-0 items-center gap-3 rounded-2xl border px-4 py-4 2xl:gap-4 2xl:px-5 transition-shadow hover:shadow-[0_4px_16px_rgba(20,40,110,0.10)]"
      style={{ background: tone.bg, borderColor: tone.border }}
    >
      <span
        className="flex size-12 shrink-0 items-center justify-center rounded-full [&>svg]:size-7 2xl:size-14 2xl:[&>svg]:size-8"
        style={{ color: tone.icon, background: tone.iconBg ?? 'transparent' }}
      >
        {icon}
      </span>
      <span className="flex min-w-0 flex-col">
        {valueFirst ? (
          <>
            <span className="truncate text-[28px] font-bold leading-tight" style={{ color: INK }}>{value}</span>
            <span className="line-clamp-2 text-sm font-medium leading-snug" style={{ color: INK }}>{label}</span>
          </>
        ) : (
          <>
            <span className="line-clamp-2 text-sm font-medium leading-snug" style={{ color: INK }}>{label}</span>
            <span className="truncate text-[28px] font-bold leading-tight" style={{ color: INK }}>{value}</span>
          </>
        )}
        <span className="mt-0.5">{delta}</span>
      </span>
    </Link>
  );
}

export function KpiSkeletonRow({ n }: { n: number }) {
  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
      {Array.from({ length: n }, (_, i) => <Skeleton key={i} className="h-[94px]" />)}
    </div>
  );
}

// ---------------------------------------------------------------- header controls

export function Dropdown<T extends string>({
  value, options, onChange, icon, className,
}: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; icon?: ReactNode; className?: string;
}) {
  const current = options.find((o) => o.value === value)?.label ?? '';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex h-11 items-center gap-2.5 rounded-xl border border-[#dfe5f2] bg-white px-4 text-sm font-medium shadow-[0_1px_4px_rgba(20,40,110,0.05)] outline-none hover:border-[#c8d2ea] focus-visible:ring-2 focus-visible:ring-[#1763e9]/30',
            className,
          )}
          style={{ color: INK }}
        >
          {icon}
          <span className="truncate">{current}</span>
          <ChevronDown className="ml-auto size-4 shrink-0 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 min-w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto">
        {options.map((o) => (
          <DropdownMenuItem key={o.value} onSelect={() => onChange(o.value)} className="gap-2">
            <Check className={cn('size-4', o.value === value ? 'opacity-100' : 'opacity-0')} />
            {o.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function RangeIcon() {
  return <CalendarDays className="size-[18px] shrink-0" style={{ color: '#1e2f6b' }} />;
}


export interface TabDef<K extends string> { key: K; label: string; icon: ReactNode }

export function DashTabs<K extends string>({
  tabs, value, onChange, active, inactive, className,
}: { tabs: TabDef<K>[]; value: K; onChange: (k: K) => void; active: string; inactive: string; className?: string }) {
  return (
    <div className={cn('flex flex-wrap gap-3', className)} role="tablist">
      {tabs.map((t) => {
        const on = t.key === value;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.key)}
            className="flex h-[52px] min-w-[13rem] items-center justify-center gap-3 rounded-t-xl px-8 text-base font-semibold transition-colors [&>svg]:size-5"
            style={on ? { background: active, color: '#fff', boxShadow: `0 6px 16px ${active}40` } : { background: inactive, color: INK }}
          >
            {t.icon}
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- charts

const niceMax = (v: number) => {
  if (v <= 0) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => v / s <= 4)!;
  return step * 4;
};
const fmtN = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 1 });

/** Vertical grouped bars, `colors[i]` for the i-th value in every group. */
export function GroupedBars({
  groups, colors, height = 210, max, pctAxis = false, labelSize = 11,
}: {
  groups: { label: string; values: number[] }[]; colors: string[]; height?: number; max?: number; pctAxis?: boolean; labelSize?: number;
}) {
  const W = 470, H = height, L = pctAxis ? 34 : 38, B = 26, T = 22;
  const top = max ?? niceMax(Math.max(1, ...groups.flatMap((g) => g.values)));
  const plotH = H - B - T;
  const slot = (W - L - 8) / Math.max(1, groups.length);
  const n = colors.length;
  const barW = Math.min(26, (slot * 0.62) / n);
  const y = (v: number) => T + plotH - (Math.min(v, top) / top) * plotH;
  const shown = pctAxis ? [0, 0.25, 0.5, 0.75, 1].map((f) => f * top) : [0, top / 4, top / 2, (3 * top) / 4, top].map((v) => Math.round(v));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img">
      {shown.map((v) => (
        <g key={v}>
          <line x1={L} x2={W - 4} y1={y(v)} y2={y(v)} stroke={GRID} strokeWidth={1} />
          <text x={L - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill={MUTED}>{pctAxis ? `${Math.round(v)}%` : fmtN(v)}</text>
        </g>
      ))}
      {groups.map((g, gi) => {
        const cx = L + slot * gi + slot / 2;
        const start = cx - (barW * n + 3 * (n - 1)) / 2;
        return (
          <g key={g.label + gi}>
            {g.values.map((v, vi) => {
              const x = start + vi * (barW + 3);
              const yy = y(v);
              return (
                <g key={vi}>
                  <rect x={x} y={yy} width={barW} height={Math.max(0, T + plotH - yy)} rx={3} fill={colors[vi]}>
                    <title>{`${g.label}: ${fmtN(v)}${pctAxis ? '%' : ''}`}</title>
                  </rect>
                  <text x={x + barW / 2} y={yy - 5} textAnchor="middle" fontSize={labelSize} fontWeight={600} fill={INK}>
                    {fmtN(v)}{pctAxis ? '%' : ''}
                  </text>
                </g>
              );
            })}
            <text x={cx} y={H - 6} textAnchor="middle" fontSize={11.5} fill={INK}>
              {g.label.length > 14 ? `${g.label.slice(0, 13)}…` : g.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export interface LineSeries { name: string; values: (number | null)[]; color: string; area?: boolean; endLabel?: boolean; pointLabels?: boolean; dashed?: boolean }

/** Line chart over category labels; null points are skipped (the line bridges them). */
export function LineChart({
  labels, series, min = 0, max, ticks, height = 220, suffix = '',
}: { labels: string[]; series: LineSeries[]; min?: number; max?: number; ticks?: number[]; height?: number; suffix?: string }) {
  const W = 470, H = height, L = 46, R = series.some((s) => s.endLabel) ? 56 : 22, T = 22, B = 26;
  const all = series.flatMap((s) => s.values.filter((v): v is number => v != null));
  const top = max ?? niceMax(Math.max(1, ...all));
  // niceMax builds the axis from four equal steps, so tick on quarters.
  const tickVals = ticks ?? [0, top / 4, top / 2, (3 * top) / 4, top];
  const plotW = W - L - R, plotH = H - T - B;
  const x = (i: number) => L + (labels.length <= 1 ? plotW / 2 : (i / (labels.length - 1)) * plotW);
  const y = (v: number) => T + plotH - ((Math.max(min, Math.min(top, v)) - min) / (top - min)) * plotH;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img">
      {tickVals.map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R + 8} y1={y(v)} y2={y(v)} stroke={GRID} />
          <text x={L - 10} y={y(v) + 4} textAnchor="end" fontSize={11.5} fill={INK}>{fmtN(v)}{suffix}</text>
        </g>
      ))}
      <line x1={L} x2={L} y1={T} y2={T + plotH} stroke="#c9d1e4" />
      {labels.map((l, i) => (
        <text key={l + i} x={x(i)} y={H - 6} textAnchor="middle" fontSize={11.5} fill={INK}>{l}</text>
      ))}
      {series.map((s) => {
        const pts = s.values.map((v, i) => (v == null ? null : [x(i), y(v)] as const)).filter((p): p is readonly [number, number] => !!p);
        if (!pts.length) return null;
        const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ');
        const lastIdx = s.values.map((v, i) => (v == null ? -1 : i)).filter((i) => i >= 0).pop()!;
        return (
          <g key={s.name}>
            {s.area && pts.length > 1 && (
              <path d={`${d} L${pts[pts.length - 1][0]},${T + plotH} L${pts[0][0]},${T + plotH} Z`} fill={s.color} opacity={0.08} />
            )}
            <path d={d} fill="none" stroke={s.color} strokeWidth={2.5} strokeDasharray={s.dashed ? '6 5' : undefined} strokeLinejoin="round" />
            {!s.dashed && pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={4.5} fill={s.color} stroke="#fff" strokeWidth={1.5} />)}
            {s.pointLabels && s.values.map((v, i) => v == null ? null : (
              <text key={i} x={x(i)} y={y(v) - 10} textAnchor="middle" fontSize={11.5} fontWeight={600} fill={INK}>{fmtN(v)}{suffix}</text>
            ))}
            {s.endLabel && s.values[lastIdx] != null && (
              <text x={x(lastIdx) + 12} y={y(s.values[lastIdx]!) + 5} fontSize={14} fontWeight={700} fill={s.color}>{fmtN(s.values[lastIdx]!)}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** A ring: one coloured arc for `pct` over a track, children centred inside. */
export function Ring({
  pct, color, track = '#dbdbdb', size = 150, stroke = 16, children,
}: { pct: number | null; color: string; track?: string; size?: number; stroke?: number; children?: ReactNode }) {
  return <Donut size={size} stroke={stroke} track={track} segments={pct == null ? [] : [{ value: pct, color }]} total={100}>{children}</Donut>;
}

/** Multi-segment donut. Segments are drawn clockwise from 12 o'clock; `total` defaults to their sum. */
export function Donut({
  segments, total, size = 150, stroke = 16, track = '#e6e9f0', gap = 0, children,
}: { segments: { value: number; color: string }[]; total?: number; size?: number; stroke?: number; track?: string; gap?: number; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const sum = total ?? segments.reduce((n, s) => n + s.value, 0);
  let offset = 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        {sum > 0 && segments.map((s, i) => {
          const len = Math.max(0, (Math.min(s.value, sum) / sum) * c - gap);
          // A zero-length arc with a round cap still paints a dot — skip it.
          const el = len <= 0.5 ? null : (
            <circle
              key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color} strokeWidth={stroke}
              strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} strokeLinecap={segments.length === 1 ? 'round' : 'butt'}
            />
          );
          offset += (s.value / sum) * c;
          return el;
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  );
}

/** Legend dot + label. */
export function LegendDot({ color, label, square = false, dashed = false }: { color: string; label: string; square?: boolean; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 text-[13px]" style={{ color: INK }}>
      {dashed ? (
        <span className="inline-block w-6 border-t-2 border-dashed" style={{ borderColor: color }} />
      ) : (
        <span className={cn('inline-block size-3', square ? 'rounded-[3px]' : 'rounded-full')} style={{ background: color }} />
      )}
      {label}
    </span>
  );
}
