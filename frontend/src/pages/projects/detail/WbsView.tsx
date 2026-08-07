import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, ChevronDown, Plus, Pencil, Trash2, Flag, Zap, ArrowUp, ArrowDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/hooks/useConfirm';
import PriorityMark from './PriorityMark';
import {
  labelOf, taskStatusVariant, priorityVariant,
  type ProjectDetail, type ProjectTask,
} from '../projectMeta';

// Live "time remaining to due date" (calendar time), like the ticket SLA countdown.
function fmtDueIn(due: string | null | undefined, nowMs: number, done: boolean): { label: string; tone: 'ok' | 'bad' | 'muted' } {
  if (done) return { label: 'Done', tone: 'muted' };
  if (!due) return { label: '—', tone: 'muted' };
  const diff = new Date(due).getTime() - nowMs;
  const abs = Math.abs(diff);
  const d = Math.floor(abs / 86_400_000);
  const h = Math.floor((abs % 86_400_000) / 3_600_000);
  const m = Math.floor((abs % 3_600_000) / 60_000);
  const parts = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
  // Compact: red "-Xd Yh" for overdue, plain "Xd Yh" for remaining (the "Due in" header + color carry the meaning).
  return diff < 0 ? { label: `-${parts}`, tone: 'bad' } : { label: parts, tone: 'ok' };
}

interface TreeNode { task: ProjectTask; children: TreeNode[] }

function buildTree(tasks: ProjectTask[]): TreeNode[] {
  const byId = new Map<string, TreeNode>(tasks.map((t) => [t.id, { task: t, children: [] }]));
  const roots: TreeNode[] = [];
  for (const t of tasks) {
    const node = byId.get(t.id)!;
    const parent = t.parentTaskId ? byId.get(t.parentTaskId) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sort = (ns: TreeNode[]) => {
    // Match the backend numbering order: sortOrder, then taskNumber as a stable tie-break.
    ns.sort((a, b) => (a.task.sortOrder ?? 0) - (b.task.sortOrder ?? 0) || (a.task.taskNumber ?? 0) - (b.task.taskNumber ?? 0));
    ns.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}

export default function WbsView({
  project, canEdit, isAdmin, onOpen, onAddChild, onDelete, onMove,
}: {
  project: ProjectDetail;
  canEdit: (t: ProjectTask) => boolean;
  isAdmin: boolean;
  onOpen: (t: ProjectTask) => void;
  onAddChild: (parent: ProjectTask | null) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, direction: 'up' | 'down') => void;
}) {
  const { confirm, ConfirmDialog } = useConfirm();
  // Re-render every minute so the "Due in" countdown ticks down live.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(id); }, []);
  const confirmDelete = async (id: string) => {
    if (await confirm({ title: 'Delete this WBS node?', description: 'This also deletes all of its children.', destructive: true, confirmText: 'Delete' })) onDelete(id);
  };
  const tree = useMemo(() => buildTree(project.tasks), [project.tasks]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setCollapsed((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // Compact date (e.g. 7/11/26) so both date columns fit without horizontal scroll.
  const fmt = (v?: string | null) =>
    (v ? new Date(v).toLocaleDateString(undefined, { year: '2-digit', month: 'numeric', day: 'numeric' }) : '—');

  const rows: React.ReactNode[] = [];
  const render = (node: TreeNode, depth: number, siblings: TreeNode[], index: number) => {
    const t = node.task;
    const hasKids = node.children.length > 0;
    const isCollapsed = collapsed.has(t.id);
    const isFirst = index === 0;
    const isLast = index === siblings.length - 1;
    // A parent always summarizes its children (rolled span) so a child can never fall
    // Every item has its OWN mandatory Start/End; show exactly those (what the user set)
    // so the WBS and the edit dialog always match. Duration = End − Start.
    const dStart = t.startDate;
    const dEnd = t.dueDate;
    const pct = t.isParent ? (t.rolledCompletionPct ?? 0) : (t.completionPct ?? 0);
    const dueIn = fmtDueIn(dEnd, now, pct >= 100);
    const durDays = dStart && dEnd ? Math.max(0, Math.round((new Date(dEnd).getTime() - new Date(dStart).getTime()) / 86400000)) : (t.durationDays ?? null);
    const extraH = t.estimatedHours != null && durDays != null ? Math.max(0, Math.round(t.estimatedHours - durDays * 9)) : 0;
    const duration = durDays != null ? (extraH ? `${durDays}d ${extraH}h` : `${durDays}d`) : '—';
    rows.push(
      <tr key={t.id} className={`group border-b ${dueIn.tone === 'bad' ? 'border-l-2 border-l-destructive bg-destructive/5 hover:bg-destructive/10' : 'hover:bg-accent/40'}`}>
        <td className="py-1.5 pr-2" style={{ paddingLeft: 8 + depth * 20 }}>
          <span className="flex items-center gap-1">
            {hasKids ? (
              <button type="button" onClick={() => toggle(t.id)} className="text-muted-foreground hover:text-foreground">
                {isCollapsed ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
              </button>
            ) : <span className="inline-block w-4" />}
            <span className="font-mono text-xs text-muted-foreground">{t.wbsCode}</span>
          </span>
        </td>
        <td className="py-1.5 pr-2">
          <button type="button" onClick={() => onOpen(t)} className={`flex items-center gap-1.5 text-left text-sm font-medium hover:underline ${dueIn.tone === 'bad' ? 'text-destructive' : ''}`}>
            {t.wbsType === 'MILESTONE' && <Flag className="size-3.5 text-primary" />}
            {t.critical && <Zap className="size-3.5 text-destructive" />}
            <PriorityMark priority={t.priority} />
            {t.title}
          </button>
        </td>
        <td className="py-1.5 px-2 text-center text-sm">{t.assigneeName || <span className="text-muted-foreground">—</span>}</td>
        <td className="py-1.5 px-2 text-center text-xs text-muted-foreground whitespace-nowrap">{fmt(dStart)}</td>
        <td className="py-1.5 px-2 text-center text-xs text-muted-foreground whitespace-nowrap">{fmt(dEnd)}</td>
        <td className="py-1.5 px-2 text-center text-sm tabular-nums whitespace-nowrap">{duration}</td>
        <td className={`py-1.5 px-2 text-center text-xs whitespace-nowrap ${dueIn.tone === 'bad' ? 'font-medium text-destructive' : dueIn.tone === 'muted' ? 'text-muted-foreground' : 'text-foreground'}`}>{dueIn.label}</td>
        <td className="py-1.5 px-2">
          <div className="flex items-center justify-center gap-1">
            <div className="h-1.5 w-10 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${pct}%` }} /></div>
            <span className="text-xs text-muted-foreground">{pct}%</span>
          </div>
        </td>
        <td className="py-1.5 px-2 text-center">
          {t.priority ? <Badge variant={priorityVariant(t.priority)}>{labelOf(t.priority)}</Badge> : null}
          <Badge variant={taskStatusVariant(t.status)} className="ml-1">{labelOf(t.status)}</Badge>
        </td>
        <td className="py-1.5 px-2">
          <div className="flex justify-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            {isAdmin && <Button size="icon" variant="ghost" className="size-6" title="Move up" disabled={isFirst} onClick={() => onMove(t.id, 'up')}><ArrowUp className="size-3.5" /></Button>}
            {isAdmin && <Button size="icon" variant="ghost" className="size-6" title="Move down" disabled={isLast} onClick={() => onMove(t.id, 'down')}><ArrowDown className="size-3.5" /></Button>}
            {isAdmin && <Button size="icon" variant="ghost" className="size-6" title="Add child" onClick={() => onAddChild(t)}><Plus className="size-3.5" /></Button>}
            <Button size="icon" variant="ghost" className="size-6" title={canEdit(t) ? 'Edit' : 'View'} onClick={() => onOpen(t)}><Pencil className="size-3.5" /></Button>
            {canEdit(t) && <Button size="icon" variant="ghost" className="size-6 text-destructive hover:text-destructive" title="Delete"
              onClick={() => confirmDelete(t.id)}><Trash2 className="size-3.5" /></Button>}
          </div>
        </td>
      </tr>,
    );
    if (!isCollapsed) node.children.forEach((c, i) => render(c, depth + 1, node.children, i));
  };
  tree.forEach((n, i) => render(n, 0, tree, i));

  return (
    <div className="overflow-x-auto rounded-lg border">
      {ConfirmDialog}
      <table className="w-full">
        <thead>
          <tr className="border-b bg-muted/40 text-xs font-medium text-muted-foreground uppercase">
            <th className="px-2 py-2 text-left">WBS</th>
            <th className="w-full px-2 py-2 text-left">Name</th>
            <th className="px-2 py-2 text-center whitespace-nowrap">Assignee</th>
            <th className="px-2 py-2 text-center whitespace-nowrap">Start</th>
            <th className="px-2 py-2 text-center whitespace-nowrap">End</th>
            <th className="px-2 py-2 text-center whitespace-nowrap">Duration</th>
            <th className="px-2 py-2 text-center whitespace-nowrap">Due in</th>
            <th className="px-2 py-2 text-center">Progress</th>
            <th className="px-2 py-2 text-center">Status</th>
            <th className="px-2 py-2 text-center">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={10} className="py-6 text-center text-sm text-muted-foreground">No WBS items yet. Add a Phase to begin.</td></tr>
          )}
          {rows}
        </tbody>
      </table>
    </div>
  );
}
