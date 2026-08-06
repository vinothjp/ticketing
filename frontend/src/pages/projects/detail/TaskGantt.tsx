import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import Gantt, { type GanttTask, type GanttPopupContext } from 'frappe-gantt';
import api from '../../../lib/api';
import { invalidateProject, labelOf, type ProjectDetail, type ProjectTask } from '../projectMeta';
import { GANTT_COLORS, resolveGanttColors, ganttStyleVars } from './ganttColors';
import './frappe-gantt.vendor.css';
import './frappe-gantt.overrides.css';

// Local YYYY-MM-DD (avoids the UTC day-shift that toISOString() can cause).
const fmt = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const DAY = 86_400_000;
const dayStart = (v: string | Date) => { const d = new Date(v); d.setHours(0, 0, 0, 0); return d; };
const NBSP = ' ';

// One WBS node → a frappe bar. Parents are summary bars using rolled span/%,
// leaves use their own dates/%. Indentation + a fold indicator convey the tree.
function ganttNode(
  t: ProjectTask, isParent: boolean, indent: number, isCollapsed: boolean, validIds: Set<string>, today: Date,
): (GanttTask & Record<string, unknown>) | null {
  const startStr = isParent ? t.rolledStart : (t.startDate ?? t.dueDate);
  const endStr = isParent ? t.rolledEnd : (t.dueDate ?? t.startDate);
  if (!startStr || !endStr) return null;
  const isMilestone = t.wbsType === 'MILESTONE';
  const due = t.dueDate ? dayStart(t.dueDate) : null;
  const overdue = !isParent && !isMilestone && t.status !== 'COMPLETED' && !!due && due < today;
  const overdueDays = overdue && due ? Math.round((today.getTime() - due.getTime()) / DAY) : 0;
  const prefix = NBSP.repeat(indent * 3) + (isParent ? (isCollapsed ? '▸ ' : '▾ ') : '');
  return {
    id: t.id,
    name: prefix + (isMilestone ? '◆ ' : '') + t.title + (overdue ? ` · overdue ${overdueDays}d` : ''),
    start: fmt(new Date(startStr)),
    end: fmt(new Date(endStr)),
    progress: (isParent ? t.rolledCompletionPct : t.completionPct) ?? 0,
    dependencies: (t.predecessors ?? []).map((p) => p.predecessorId).filter((id) => validIds.has(id)).join(','),
    custom_class: isParent ? 'gt-section' : isMilestone ? 'gt-milestone' : overdue ? 'gt-overdue' : `gt-${t.status}`,
    _status: t.status,
    _type: t.wbsType,
    _assignee: t.assigneeName ?? '',
    _due: t.dueDate ? new Date(t.dueDate).toLocaleDateString() : '',
    _isParent: isParent,
  };
}

export default function TaskGantt({
  project, onEdit,
}: {
  project: ProjectDetail;
  onEdit: (t: ProjectTask) => void;
}) {
  const qc = useQueryClient();
  const containerRef = useRef<HTMLDivElement>(null);
  const ganttRef = useRef<Gantt | null>(null);
  // Per-project bar colors (Settings → Gantt chart colours), applied as CSS vars.
  const colors = useMemo(() => resolveGanttColors(project.features), [project.features]);
  // Ids of collapsed WBS parents (click a summary bar to fold/unfold it).
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleCollapse = (id: string) =>
    setCollapsed((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });

  const dateMutation = useMutation({
    mutationFn: (v: { id: string; startDate: string; dueDate: string }) =>
      api.patch(`/api/projects/tasks/${v.id}`, { startDate: v.startDate, dueDate: v.dueDate }),
    onSuccess: () => { invalidateProject(qc); toast.success('Task dates updated'); },
    onError: (e: any) => {
      toast.error(e.response?.data?.message || 'Error updating dates');
      invalidateProject(qc); // snap the bar back
    },
  });

  const childrenOf = useMemo(() => {
    const m = new Map<string, ProjectTask[]>();
    for (const t of project.tasks) if (t.parentTaskId) (m.get(t.parentTaskId) ?? m.set(t.parentTaskId, []).get(t.parentTaskId)!).push(t);
    for (const arr of m.values()) arr.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    return m;
  }, [project.tasks]);

  // Pre-order walk of the WBS tree → bars (parents as collapsible summaries).
  const ganttTasks = useMemo(() => {
    const today = dayStart(new Date());
    const validIds = new Set(project.tasks.map((t) => t.id));
    const roots = project.tasks.filter((t) => !t.parentTaskId).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const out: (GanttTask & Record<string, unknown>)[] = [];
    const walk = (t: ProjectTask, indent: number) => {
      const kids = childrenOf.get(t.id) ?? [];
      const isParent = kids.length > 0;
      const node = ganttNode(t, isParent, indent, collapsed.has(t.id), validIds, today);
      if (node) out.push(node);
      if (isParent && !collapsed.has(t.id)) for (const k of kids) walk(k, indent + 1);
    };
    for (const r of roots) walk(r, 0);
    return out;
  }, [project.tasks, childrenOf, collapsed]);

  // Rebuild the chart whenever the (dated) task set changes.
  const signature = useMemo(
    () => JSON.stringify(ganttTasks.map((t) => [t.id, t.start, t.end, t.progress, t.dependencies])),
    [ganttTasks],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.innerHTML = '';
    if (ganttTasks.length === 0) { ganttRef.current = null; return; }

    ganttRef.current = new Gantt(el, ganttTasks, {
      view_mode: 'Week',
      view_mode_select: true,
      today_button: true,
      readonly_progress: true,
      infinite_padding: false,
      popup_on: 'hover',
      scroll_to: 'today',
      popup: (ctx: GanttPopupContext) => {
        const t = ctx.task as GanttTask & Record<string, string>;
        const rows = [
          t._type === 'MILESTONE' ? 'Milestone' : `Status: ${labelOf(t._status)}`,
          t._assignee ? `Assignee: ${t._assignee}` : '',
          t._due ? `Due: ${t._due}` : '',
        ].filter(Boolean).join('<br>');
        return `<div class="title">${t.name}</div><div class="details">${rows}</div>`;
      },
      on_click: (task: GanttTask) => {
        const full = project.tasks.find((x) => x.id === task.id);
        if (!full) return;
        // A parent summary bar folds/unfolds; a leaf opens the editor.
        if ((childrenOf.get(full.id) ?? []).length > 0) { toggleCollapse(full.id); return; }
        onEdit(full);
      },
      on_date_change: (task: GanttTask, start: Date, end: Date) => {
        const full = project.tasks.find((x) => x.id === task.id);
        if (full && (childrenOf.get(full.id) ?? []).length > 0) return; // don't persist summary bars
        dateMutation.mutate({ id: task.id, startDate: fmt(start), dueDate: fmt(end) });
      },
    });

    return () => { el.innerHTML = ''; ganttRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  if (ganttTasks.length === 0) {
    return (
      <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
        No scheduled tasks yet. Add a start or due date to tasks to see them on the timeline.
      </div>
    );
  }

  return (
    <div className="min-w-0" style={ganttStyleVars(colors)}>
      <p className="mb-2 text-xs text-muted-foreground">
        Drag a bar to reschedule · drag its edge to resize · click a section bar to fold/unfold · click a task to edit · use the view selector for Day / Week / Month.
      </p>
      {/* Legend — colours come from Settings → Gantt chart colours. */}
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
        {GANTT_COLORS.map((c) => (
          <span key={c.key} className="inline-flex items-center gap-1.5">
            <span className="inline-block size-3 rounded-[3px]" style={{ backgroundColor: colors[c.key] }} />
            {c.label}
          </span>
        ))}
      </div>
      <div ref={containerRef} className="min-w-0 max-w-full" />
    </div>
  );
}
