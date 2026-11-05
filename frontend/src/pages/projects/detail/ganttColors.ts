import type { CSSProperties } from 'react';

// The bar categories shown on the Gantt timeline + its legend, and configurable in Settings.
export interface GanttColorDef { key: string; label: string; default: string; cssVar: string; }

export const GANTT_COLORS: GanttColorDef[] = [
  { key: 'section',    label: 'Phase',       default: '#6366f1', cssVar: '--gt-section' },
  { key: 'todo',       label: 'To Do',       default: '#94a3b8', cssVar: '--gt-todo' },
  { key: 'inProgress', label: 'In Progress', default: '#3b82f6', cssVar: '--gt-inprogress' },
  { key: 'review',     label: 'Review',      default: '#f59e0b', cssVar: '--gt-review' },
  { key: 'completed',  label: 'Completed',   default: '#22c55e', cssVar: '--gt-completed' },
  { key: 'milestone',  label: 'Milestone',   default: '#8b5cf6', cssVar: '--gt-milestone' },
  { key: 'overdue',    label: 'Overdue',     default: '#ef4444', cssVar: '--gt-overdue' },
];

export type GanttColorMap = Record<string, string>;

// Saved colors (project.features.ganttColors) merged over the defaults.
export function resolveGanttColors(features?: Record<string, any> | null): GanttColorMap {
  const saved = (features?.ganttColors ?? {}) as Record<string, string>;
  const out: GanttColorMap = {};
  for (const c of GANTT_COLORS) out[c.key] = saved[c.key] || c.default;
  return out;
}

export function defaultGanttColors(): GanttColorMap {
  const out: GanttColorMap = {};
  for (const c of GANTT_COLORS) out[c.key] = c.default;
  return out;
}

// Inline CSS custom properties that theme the frappe bars (inherited by descendants).
export function ganttStyleVars(colors: GanttColorMap): CSSProperties {
  const s: Record<string, string> = {};
  for (const c of GANTT_COLORS) s[c.cssVar] = colors[c.key];
  return s as CSSProperties;
}
