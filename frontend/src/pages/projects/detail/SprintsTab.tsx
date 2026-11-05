import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Play, CheckCircle2, Trash2, Inbox, Rocket, Link2, ArrowRightLeft } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../../lib/api';
import { useAuth } from '../../../context/AuthContext';
import { useConfirm } from '@/hooks/useConfirm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  invalidateProject, labelOf, taskStatusVariant, sprintStatusVariant, wbsOrder,
  type ProjectDetail, type ProjectTask,
} from '../projectMeta';

const BACKLOG = '__backlog__';

// Sprints hold leaf work only (the Jira / Azure DevOps model). A summary item — anything with
// children, or a phase — never sits in a sprint itself: it runs across sprints, and where its
// work lands is read off its leaves. So nothing is ever counted twice.
const isLeaf = (t: ProjectTask) => !t.isParent && t.wbsType !== 'PHASE';

// One row of a group: `member` rows are the group's own leaves; the rest are WBS ancestors
// shown as grey headings so each leaf reads in place — context only, never counted.
interface GroupRow { task: ProjectTask; member: boolean }

// Rows are never indented — the WBS number carries the level, so every row keeps its full width.
// Every row shares one fixed column grid (code · title · status · points · sprint), so the values
// line up down a panel like a table.
const CODE_COL = 'w-14 shrink-0 font-mono text-xs text-muted-foreground';

// A heading's menu moves the whole branch: every leaf beneath it in *this* group, and only those.
function ContextLine({ task, targets, onMoveBranch }: {
  task: ProjectTask;
  targets: { id: string | null; name: string }[];
  onMoveBranch: (taskId: string, sprintId: string | null) => void;
}) {
  return (
    <div className="flex h-9 items-center gap-3 bg-muted/40 px-3 text-xs font-medium text-muted-foreground">
      <span className={CODE_COL}>{task.wbsCode}</span>
      <span className="min-w-0 flex-1 truncate" title={task.title}>{task.title}</span>
      {targets.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost" className="h-6 gap-1 px-2 text-xs font-normal text-muted-foreground" title="Move every task under this item">
              <ArrowRightLeft className="size-3" /> Move all
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Move its tasks to</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {targets.map((t) => (
              <DropdownMenuItem key={t.id ?? BACKLOG} onSelect={() => onMoveBranch(task.id, t.id)}>{t.name}</DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

function TaskLine({ task, sprintOptions, onMove, onPoints }: {
  task: ProjectTask;
  sprintOptions: { id: string; name: string }[];
  onMove: (taskId: string, sprintId: string | null) => void;
  onPoints: (taskId: string, points: number | null) => void;
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 text-sm transition-colors hover:bg-muted/30">
      <span className={CODE_COL}>{task.wbsCode}</span>
      <span className="min-w-0 flex-1 truncate" title={task.title}>{task.title}</span>
      <span className="flex w-24 shrink-0 justify-center">
        <Badge variant={taskStatusVariant(task.status)}>{labelOf(task.status)}</Badge>
      </span>
      <Input
        type="number" min={0}
        className="h-7 w-12 shrink-0 px-1 text-center text-xs"
        placeholder="pts"
        title="Story points"
        defaultValue={task.storyPoints ?? ''}
        onBlur={(e) => {
          const v = e.target.value === '' ? null : Number(e.target.value);
          if (v !== (task.storyPoints ?? null)) onPoints(task.id, v);
        }}
      />
      <Select value={task.sprintId ?? BACKLOG} onValueChange={(v) => onMove(task.id, v === BACKLOG ? null : v)}>
        <SelectTrigger size="sm" className="h-7 w-32 shrink-0 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={BACKLOG}>Backlog</SelectItem>
          {sprintOptions.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

// One column heading. Both columns use it at the same height, so their panels start level.
function ColumnHead({ icon: Icon, label, count, children }: {
  icon: typeof Inbox; label: string; count: number; children?: ReactNode;
}) {
  return (
    <div className="flex h-9 items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-muted-foreground" />
        <span className="text-sm font-semibold">{label}</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{count}</span>
      </div>
      {children}
    </div>
  );
}

function EmptyPanel({ children }: { children: ReactNode }) {
  return <div className="px-3 py-8 text-center text-sm text-muted-foreground">{children}</div>;
}

export default function SprintsTab({ project }: { project: ProjectDetail }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const admin = !!user?.roles.includes('Admin');
  const { confirm, ConfirmDialog } = useConfirm();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const invalidate = () => invalidateProject(qc);

  const createSprint = useMutation({
    mutationFn: () => api.post(`/api/projects/${project.id}/sprints`, { name: name.trim(), goal: goal.trim() || undefined }),
    onSuccess: () => { invalidate(); setCreateOpen(false); setName(''); setGoal(''); toast.success('Sprint created'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error creating sprint'),
  });
  const setStatus = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'start' | 'complete' }) => api.post(`/api/projects/sprints/${id}/${action}`),
    onSuccess: invalidate,
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error updating sprint'),
  });
  const delSprint = useMutation({
    mutationFn: (id: string) => api.delete(`/api/projects/sprints/${id}`),
    onSuccess: () => { invalidate(); toast.success('Sprint deleted'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error deleting sprint'),
  });
  const moveTask = useMutation({
    mutationFn: ({ taskId, sprintId }: { taskId: string; sprintId: string | null }) => api.patch(`/api/projects/tasks/${taskId}`, { sprintId }),
    onSuccess: invalidate,
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error moving task'),
  });
  // Moves a branch: every leaf under `taskId` currently in `fromSprintId` goes to `sprintId`.
  const moveBranch = useMutation({
    mutationFn: (v: { taskId: string; sprintId: string | null; fromSprintId: string | null }) =>
      api.post<{ moved: number }>(`/api/projects/tasks/${v.taskId}/sprint`, { sprintId: v.sprintId, fromSprintId: v.fromSprintId }),
    onSuccess: (res) => {
      invalidate();
      const n = res.data.moved;
      if (n) toast.success(`${n} task${n === 1 ? '' : 's'} moved`);
      else toast.info('Nothing to move — its tasks are already placed');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error moving tasks'),
  });
  const setPoints = useMutation({
    mutationFn: ({ taskId, points }: { taskId: string; points: number | null }) => api.patch(`/api/projects/tasks/${taskId}`, { storyPoints: points }),
    onSuccess: invalidate,
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  });

  const sprintOptions = project.sprints.map((s) => ({ id: s.id, name: s.name }));
  // Everything here follows the WBS tab's order, and every group reads the same way: its own
  // leaves as rows, under their WBS ancestors as grey headings.
  const ordered = useMemo(() => wbsOrder(project.tasks), [project.tasks]);
  const groupRows = (inGroup: (t: ProjectTask) => boolean): GroupRow[] => {
    const byId = new Map(project.tasks.map((t) => [t.id, t]));
    const show = new Set<string>();
    for (const { task } of ordered) {
      if (!inGroup(task)) continue;
      show.add(task.id);
      for (let p = task.parentTaskId; p && byId.has(p) && !show.has(p); p = byId.get(p)!.parentTaskId) show.add(p);
    }
    return ordered.filter((r) => show.has(r.task.id)).map((r) => ({ ...r, member: inGroup(r.task) }));
  };
  // `group` is the sprint these rows sit in (null = backlog) — a heading moves only its leaves here.
  const renderRows = (rows: GroupRow[], group: string | null) => {
    const targets = [
      ...(group ? [{ id: null, name: 'Backlog' }] : []),
      ...sprintOptions.filter((o) => o.id !== group),
    ];
    return rows.map(({ task, member }) => (member
      ? <TaskLine key={task.id} task={task} sprintOptions={sprintOptions} onMove={onMove} onPoints={onPoints} />
      : <ContextLine key={task.id} task={task} targets={admin ? targets : []}
          onMoveBranch={(taskId, sprintId) => moveBranch.mutate({ taskId, sprintId, fromSprintId: group })} />));
  };
  const backlogRows = groupRows((t) => isLeaf(t) && !t.sprintId);
  const backlog = backlogRows.filter((r) => r.member).map((r) => r.task);
  const backlogUnder = (id: string): number => project.tasks
    .filter((c) => c.parentTaskId === id)
    .reduce((n, c) => n + (isLeaf(c) ? (c.sprintId ? 0 : 1) : backlogUnder(c.id)), 0);
  const pointsOf = (tasks: ProjectTask[]) => tasks.reduce((n, t) => n + (t.storyPoints ?? 0), 0);
  const onMove = (taskId: string, sprintId: string | null) => moveTask.mutate({ taskId, sprintId });
  const onPoints = (taskId: string, points: number | null) => setPoints.mutate({ taskId, points });

  return (
    <div className="space-y-4">
      {ConfirmDialog}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Sprint</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <div className="mb-1 text-sm">Title</div>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sprint 1" />
            </div>
            <div>
              <div className="mb-1 text-sm">Sprint goal</div>
              <Textarea rows={2} value={goal} onChange={(e) => setGoal(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button disabled={!name.trim() || createSprint.isPending} onClick={() => createSprint.mutate()}>
              {createSprint.isPending ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-2">
        {/* Backlog — runs its full length; the page scrolls, not the panel. */}
        <section className="space-y-3">
          <ColumnHead icon={Inbox} label="Backlog" count={backlog.length}>
            <span className="text-xs text-muted-foreground">{pointsOf(backlog)} pts</span>
          </ColumnHead>
          <div className="overflow-hidden rounded-lg border bg-card">
            {backlog.length === 0
              ? <EmptyPanel>Backlog is empty — every task is in a sprint.</EmptyPanel>
              : (
                <div className="divide-y">{renderRows(backlogRows, null)}</div>
              )}
          </div>
        </section>

        {/* Sprints — the column carries its own New Sprint button, so the tab needs no header row. */}
        <section className="space-y-3">
          <ColumnHead icon={Rocket} label="Sprints" count={project.sprints.length}>
            <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="size-4" /> New Sprint</Button>
          </ColumnHead>
          {project.sprints.length === 0 && (
            <div className="rounded-lg border border-dashed bg-card">
              <EmptyPanel>
                <Rocket className="mx-auto mb-2 size-6 opacity-50" /> No sprints yet. Create one and pull tasks from the backlog.
              </EmptyPanel>
            </div>
          )}
          <div className="space-y-5">
            {project.sprints.map((s) => {
              const rows = groupRows((t) => isLeaf(t) && t.sprintId === s.id);
              const tasks = rows.filter((r) => r.member).map((r) => r.task);
              // Leaves not already in this sprint, plus (admins) any summary item with backlog
              // leaves beneath it — picking one pulls that branch's backlog work in.
              const linkable = ordered.map((r) => r.task)
                .map((t) => ({ t, pull: isLeaf(t) || !admin ? 0 : backlogUnder(t.id) }))
                .filter(({ t, pull }) => (isLeaf(t) ? t.sprintId !== s.id : pull > 0));
              return (
                <div key={s.id} className="overflow-hidden rounded-lg border bg-card">
                  <div className="space-y-1 border-b bg-muted/50 px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 truncate text-sm font-semibold" title={s.name}>{s.name}</span>
                      <Badge variant={sprintStatusVariant(s.status)}>{labelOf(s.status)}</Badge>
                      <div className="ml-auto flex shrink-0 items-center gap-1">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="sm" variant="outline" className="h-7 bg-background" disabled={linkable.length === 0}>
                              <Link2 className="size-3.5" /> Link task
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="max-h-72 w-72 overflow-y-auto">
                            <DropdownMenuLabel>Add an existing task</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            {linkable.map(({ t, pull }) => (
                              <DropdownMenuItem key={t.id} onSelect={() => (isLeaf(t)
                                ? moveTask.mutate({ taskId: t.id, sprintId: s.id })
                                : moveBranch.mutate({ taskId: t.id, sprintId: s.id, fromSprintId: null }))}>
                                <span className="truncate">
                                  <span className="font-mono text-muted-foreground">{t.wbsCode}</span> {t.title}
                                  {!isLeaf(t) && <span className="text-muted-foreground"> · {pull} backlog task{pull === 1 ? '' : 's'}</span>}
                                  {isLeaf(t) && t.sprintId ? <span className="text-muted-foreground"> · in another sprint</span> : ''}
                                </span>
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                        {s.status === 'PLANNED' && (
                          <Button size="sm" variant="outline" className="h-7 bg-background" onClick={() => setStatus.mutate({ id: s.id, action: 'start' })}>
                            <Play className="size-3.5" /> Start
                          </Button>
                        )}
                        {s.status === 'ACTIVE' && (
                          <Button size="sm" variant="outline" className="h-7 bg-background" onClick={() => setStatus.mutate({ id: s.id, action: 'complete' })}>
                            <CheckCircle2 className="size-3.5" /> Complete
                          </Button>
                        )}
                        <Button size="icon" variant="ghost" className="size-7 text-destructive hover:text-destructive" title="Delete sprint"
                          onClick={async () => { if (await confirm({ title: `Delete sprint "${s.name}"?`, description: 'Its tasks return to the backlog.', destructive: true, confirmText: 'Delete' })) delSprint.mutate(s.id); }}>
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="shrink-0">{tasks.length} task{tasks.length === 1 ? '' : 's'} · {pointsOf(tasks)} pts</span>
                      {s.goal && <span className="min-w-0 truncate" title={s.goal}>· {s.goal}</span>}
                    </div>
                  </div>
                  {tasks.length === 0
                    ? <EmptyPanel>No tasks yet — use Link task or a task's sprint dropdown.</EmptyPanel>
                    : <div className="divide-y">{renderRows(rows, s.id)}</div>}
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
