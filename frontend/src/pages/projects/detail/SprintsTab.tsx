import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Play, CheckCircle2, Trash2, Inbox, Rocket, Link2 } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../../lib/api';
import { useConfirm } from '@/hooks/useConfirm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  invalidateProject, labelOf, taskStatusVariant, sprintStatusVariant, taskKey,
  type ProjectDetail, type ProjectTask,
} from '../projectMeta';

const BACKLOG = '__backlog__';

function TaskLine({ task, projectKey, sprintOptions, onMove, onPoints }: {
  task: ProjectTask;
  projectKey: string | null;
  sprintOptions: { id: string; name: string }[];
  onMove: (taskId: string, sprintId: string | null) => void;
  onPoints: (taskId: string, points: number | null) => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded border px-2 py-1.5 text-sm">
      <span className="shrink-0 text-xs text-muted-foreground">{taskKey(projectKey, task.taskNumber)}</span>
      <span className="min-w-0 flex-1 truncate">{task.title}</span>
      <Badge variant={taskStatusVariant(task.status)}>{labelOf(task.status)}</Badge>
      <Input
        type="number" min={0}
        className="h-7 w-14"
        title="Story points"
        defaultValue={task.storyPoints ?? ''}
        onBlur={(e) => {
          const v = e.target.value === '' ? null : Number(e.target.value);
          if (v !== (task.storyPoints ?? null)) onPoints(task.id, v);
        }}
      />
      <Select value={task.sprintId ?? BACKLOG} onValueChange={(v) => onMove(task.id, v === BACKLOG ? null : v)}>
        <SelectTrigger size="sm" className="w-36"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={BACKLOG}>Backlog</SelectItem>
          {sprintOptions.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

export default function SprintsTab({ project }: { project: ProjectDetail }) {
  const qc = useQueryClient();
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
  const setPoints = useMutation({
    mutationFn: ({ taskId, points }: { taskId: string; points: number | null }) => api.patch(`/api/projects/tasks/${taskId}`, { storyPoints: points }),
    onSuccess: invalidate,
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  });

  const sprintOptions = project.sprints.map((s) => ({ id: s.id, name: s.name }));
  const backlog = project.tasks.filter((t) => !t.sprintId);
  const pointsOf = (tasks: ProjectTask[]) => tasks.reduce((n, t) => n + (t.storyPoints ?? 0), 0);
  const onMove = (taskId: string, sprintId: string | null) => moveTask.mutate({ taskId, sprintId });
  const onPoints = (taskId: string, points: number | null) => setPoints.mutate({ taskId, points });

  return (
    <div className="space-y-4">
      {ConfirmDialog}
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{project.sprints.length} sprint{project.sprints.length === 1 ? '' : 's'} · {backlog.length} in backlog</span>
        <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="size-4" /> New Sprint</Button>
      </div>

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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Backlog */}
        <Card>
          <CardContent className="space-y-2 py-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Inbox className="size-4 text-muted-foreground" /> Backlog
              <span className="text-xs text-muted-foreground">{backlog.length}</span>
            </div>
            {backlog.length === 0 && <p className="text-xs text-muted-foreground">Backlog is empty.</p>}
            {backlog.map((t) => (
              <TaskLine key={t.id} task={t} projectKey={project.key ?? null} sprintOptions={sprintOptions} onMove={onMove} onPoints={onPoints} />
            ))}
          </CardContent>
        </Card>

        {/* Sprints */}
        <div className="space-y-4">
          {project.sprints.length === 0 && (
            <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
              <Rocket className="mx-auto mb-2 size-6 opacity-50" /> No sprints yet. Create one and pull tasks from the backlog.
            </CardContent></Card>
          )}
          {project.sprints.map((s) => {
            const tasks = project.tasks.filter((t) => t.sprintId === s.id);
            return (
              <Card key={s.id}>
                <CardContent className="space-y-2 py-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{s.name}</span>
                      <Badge variant={sprintStatusVariant(s.status)}>{labelOf(s.status)}</Badge>
                      <span className="text-xs text-muted-foreground">{tasks.length} tasks · {pointsOf(tasks)} pts</span>
                    </div>
                    <div className="flex gap-1">
                      {(() => {
                        // Leaf tasks not already in this sprint — candidates to link in.
                        const linkable = project.tasks.filter((t) => t.sprintId !== s.id && !t.isParent && t.wbsType !== 'PHASE');
                        return (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="sm" variant="outline" className="h-7" disabled={linkable.length === 0}>
                                <Link2 className="size-3.5" /> Link task
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent className="max-h-72 w-72 overflow-y-auto">
                              <DropdownMenuLabel>Add an existing task</DropdownMenuLabel>
                              <DropdownMenuSeparator />
                              {linkable.map((t) => (
                                <DropdownMenuItem key={t.id} onSelect={() => moveTask.mutate({ taskId: t.id, sprintId: s.id })}>
                                  <span className="truncate">
                                    {taskKey(project.key ?? null, t.taskNumber)} {t.title}
                                    {t.sprintId ? <span className="text-muted-foreground"> · in another sprint</span> : ''}
                                  </span>
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        );
                      })()}
                      {s.status === 'PLANNED' && (
                        <Button size="sm" variant="outline" className="h-7" onClick={() => setStatus.mutate({ id: s.id, action: 'start' })}>
                          <Play className="size-3.5" /> Start
                        </Button>
                      )}
                      {s.status === 'ACTIVE' && (
                        <Button size="sm" variant="outline" className="h-7" onClick={() => setStatus.mutate({ id: s.id, action: 'complete' })}>
                          <CheckCircle2 className="size-3.5" /> Complete
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" className="h-7 text-destructive hover:text-destructive"
                        onClick={async () => { if (await confirm({ title: `Delete sprint "${s.name}"?`, description: 'Its tasks return to the backlog.', destructive: true, confirmText: 'Delete' })) delSprint.mutate(s.id); }}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                  {s.goal && <p className="text-xs text-muted-foreground">{s.goal}</p>}
                  {tasks.length === 0 && <p className="text-xs text-muted-foreground">No tasks in this sprint.</p>}
                  {tasks.map((t) => (
                    <TaskLine key={t.id} task={t} projectKey={project.key ?? null} sprintOptions={sprintOptions} onMove={onMove} onPoints={onPoints} />
                  ))}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
