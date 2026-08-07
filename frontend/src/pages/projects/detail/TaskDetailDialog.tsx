import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2, Plus, X, Eye, MessageSquare, GitBranch, ListTree, FileText, Zap } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../../lib/api';
import { useAuth } from '../../../context/AuthContext';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { DateField } from '@/components/ui/date-field';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  TASK_STATUSES, PRIORITIES, invalidateProject, labelOf, taskStatusVariant, taskKey,
  type TaskDetail, type ProjectTask, type UserOption,
} from '../projectMeta';

const NONE = '__none__';
const toDateInput = (v?: string | null) => (v ? new Date(v).toISOString().slice(0, 10) : '');

function Section({ icon: Icon, title, count, children }: {
  icon: typeof Eye; title: string; count?: number; children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Icon className="size-4 text-muted-foreground" /> {title}
        {count != null && <span className="text-xs text-muted-foreground">{count}</span>}
      </div>
      {children}
    </div>
  );
}

export default function TaskDetailDialog({
  taskId, projectId, projectKey, users, tasks, projectStart, projectEnd, onClose,
}: {
  taskId: string | null;
  projectId: string;
  projectKey: string | null;
  users: UserOption[];
  tasks: ProjectTask[];
  projectStart?: string;
  projectEnd?: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = !!user?.roles.includes('Admin');
  const myId = user?.id ?? null;
  const [comment, setComment] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [subtaskInput, setSubtaskInput] = useState('');

  const { data: task } = useQuery<TaskDetail>({
    queryKey: ['project-task', taskId],
    queryFn: async () => (await api.get(`/api/projects/tasks/${taskId}/detail`)).data,
    enabled: !!taskId,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['project-task', taskId] });
    invalidateProject(qc);
  };
  const mut = (fn: () => Promise<unknown>, ok?: string) =>
    ({ mutationFn: fn, onSuccess: () => { invalidate(); if (ok) toast.success(ok); },
       onError: (e: any) => toast.error(e.response?.data?.message || 'Error') });

  const patchTask = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.patch(`/api/projects/tasks/${taskId}`, data),
    onSuccess: invalidate,
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error updating task'),
  });
  const addComment = useMutation(mut(() => api.post(`/api/projects/tasks/${taskId}/comments`, { body: comment.trim() }), 'Comment added'));
  const delComment = useMutation({ mutationFn: (id: string) => api.delete(`/api/projects/task-comments/${id}`), onSuccess: invalidate });
  const addWatcher = useMutation({ mutationFn: (userId: string) => api.post(`/api/projects/tasks/${taskId}/watchers`, { userId }), onSuccess: invalidate });
  const delWatcher = useMutation({ mutationFn: (userId: string) => api.delete(`/api/projects/tasks/${taskId}/watchers/${userId}`), onSuccess: invalidate });
  const addSubtask = useMutation(mut(() => api.post(`/api/projects/${projectId}/tasks`, { title: subtaskInput.trim(), parentTaskId: taskId }), 'Sub-task added'));
  const addDep = useMutation({ mutationFn: (predecessorId: string) => api.post(`/api/projects/tasks/${taskId}/dependencies`, { predecessorId }), onSuccess: invalidate, onError: (e: any) => toast.error(e.response?.data?.message || 'Error') });
  const delDep = useMutation({ mutationFn: (depId: string) => api.delete(`/api/projects/dependencies/${depId}`), onSuccess: invalidate });

  if (!task) {
    return (
      <Dialog open={!!taskId} onOpenChange={(o) => !o && onClose()}>
        <DialogContent><p className="text-muted-foreground">Loading...</p></DialogContent>
      </Dialog>
    );
  }

  const canEdit = isAdmin || task.assigneeUserId === myId;
  // Live WBS numbers come from the project list (computed), not the raw task record.
  const wbsById = new Map(tasks.map((t) => [t.id, t.wbsCode]));
  const myWbs = wbsById.get(taskId ?? '') ?? null;
  // Constrain the date pickers to (parent window ∩ project window); a child fits inside its parent.
  const meInList = tasks.find((x) => x.id === taskId);
  const parentTask = meInList?.parentTaskId ? tasks.find((x) => x.id === meInList.parentTaskId) : undefined;
  const parentStart = parentTask ? toDateInput(parentTask.startDate) : undefined;
  const parentEnd = parentTask ? toDateInput(parentTask.dueDate) : undefined;
  const latest = (...ds: (string | undefined)[]) => ds.filter(Boolean).sort().slice(-1)[0] as string | undefined;
  const earliest = (...ds: (string | undefined)[]) => ds.filter(Boolean).sort()[0] as string | undefined;
  const pMin = latest(parentStart, projectStart);        // floor: later of parent start / project start
  const pMax = parentEnd ?? projectEnd;                    // cap by parent end; top-level phase by project end
  const tags = task.tags ?? [];
  const watcherIds = new Set(task.watchers.map((w) => w.userId));
  const predIds = new Set(task.predecessors.map((l) => l.predecessor.id));
  const depCandidates = tasks.filter((t) => t.id !== task.id && !predIds.has(t.id));

  const submitComment = () => { if (comment.trim()) addComment.mutate(undefined, { onSuccess: () => setComment('') }); };
  const submitTag = () => {
    const t = tagInput.trim();
    if (t && !tags.includes(t)) patchTask.mutate({ tags: [...tags, t] }, { onSuccess: () => setTagInput('') });
  };
  const removeTag = (t: string) => patchTask.mutate({ tags: tags.filter((x) => x !== t) });
  const submitSubtask = () => { if (subtaskInput.trim()) addSubtask.mutate(undefined, { onSuccess: () => setSubtaskInput('') }); };

  return (
    <Dialog open={!!taskId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[86vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {myWbs && <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-normal text-muted-foreground">{myWbs}</span>}
            <span className="text-xs font-normal text-muted-foreground">{taskKey(projectKey, task.taskNumber)}</span>
            {task.title}
            {!canEdit && <Badge variant="outline" className="ml-1 font-normal">View only</Badge>}
          </DialogTitle>
        </DialogHeader>

        {/* Properties */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <div className="mb-1 text-xs text-muted-foreground">Status</div>
            <Select value={task.status} onValueChange={(v) => patchTask.mutate({ status: v })} disabled={!canEdit}>
              <SelectTrigger size="sm" className="w-full"><Badge variant={taskStatusVariant(task.status)}>{labelOf(task.status)}</Badge></SelectTrigger>
              <SelectContent>{TASK_STATUSES.map((s) => <SelectItem key={s} value={s}>{labelOf(s)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <div className="mb-1 text-xs text-muted-foreground">Priority</div>
            <Select value={task.priority ?? NONE} onValueChange={(v) => patchTask.mutate({ priority: v === NONE ? null : v })} disabled={!canEdit}>
              <SelectTrigger size="sm" className="w-full"><SelectValue placeholder="None" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>None</SelectItem>
                {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{labelOf(p)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <div className="mb-1 text-xs text-muted-foreground">Assignee</div>
            <Select value={task.assigneeUserId ?? NONE} onValueChange={(v) => patchTask.mutate({ assigneeUserId: v === NONE ? null : v })} disabled={!canEdit}>
              <SelectTrigger size="sm" className="w-full"><SelectValue placeholder="Unassigned" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Unassigned</SelectItem>
                {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.username}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <div className="mb-1 text-xs text-muted-foreground">Start date</div>
            <DateField disabled={!canEdit} value={toDateInput(task.startDate)} min={pMin} max={earliest(toDateInput(task.dueDate) || undefined, pMax)} onChange={(v) => patchTask.mutate({ startDate: v || undefined })} />
          </div>
          <div>
            <div className="mb-1 text-xs text-muted-foreground">End date</div>
            <DateField disabled={!canEdit} value={toDateInput(task.dueDate)} min={latest(toDateInput(task.startDate), pMin)} max={pMax} onChange={(v) => patchTask.mutate({ dueDate: v || undefined })} />
          </div>
        </div>

        {/* Critical path flag (shows the ⚡ marker in the WBS) */}
        <label className="flex w-fit items-center gap-2 text-sm">
          <Checkbox checked={!!task.critical} disabled={!canEdit} onCheckedChange={(v) => patchTask.mutate({ critical: !!v })} />
          <span className="flex items-center gap-1"><Zap className="size-3.5 text-destructive" /> Critical path</span>
        </label>

        {/* Description */}
        <Section icon={FileText} title="Description">
          <Textarea
            key={task.id}
            rows={3}
            readOnly={!canEdit}
            defaultValue={task.description ?? ''}
            placeholder={canEdit ? 'Add a short summary of this task…' : 'No description'}
            onBlur={(e) => { if (!canEdit) return; const v = e.target.value; if (v !== (task.description ?? '')) patchTask.mutate({ description: v }); }}
          />
        </Section>

        {/* Tags */}
        <Section icon={GitBranch} title="Tags">
          <div className="flex flex-wrap items-center gap-2">
            {tags.map((t) => (
              <Badge key={t} variant="secondary" className="gap-1">
                {t}
                {canEdit && <button type="button" onClick={() => removeTag(t)}><X className="size-3" /></button>}
              </Badge>
            ))}
            {tags.length === 0 && <span className="text-xs text-muted-foreground">No tags</span>}
            {canEdit && (
              <Input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitTag(); } }}
                placeholder="Add tag + Enter"
                className="h-7 w-36"
              />
            )}
          </div>
        </Section>

        {/* Watchers */}
        <Section icon={Eye} title="Watchers" count={task.watchers.length}>
          <div className="flex flex-wrap items-center gap-2">
            {task.watchers.map((w) => (
              <Badge key={w.id} variant="outline" className="gap-1">
                {w.user.username}
                {canEdit && <button type="button" onClick={() => delWatcher.mutate(w.userId)}><X className="size-3" /></button>}
              </Badge>
            ))}
            {task.watchers.length === 0 && <span className="text-xs text-muted-foreground">None</span>}
            {canEdit && (
              <Select value="" onValueChange={(v) => addWatcher.mutate(v)}>
                <SelectTrigger size="sm" className="w-40"><SelectValue placeholder="Add watcher" /></SelectTrigger>
                <SelectContent>
                  {users.filter((u) => !watcherIds.has(u.id)).map((u) => <SelectItem key={u.id} value={u.id}>{u.username}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>
        </Section>

        {/* Dependencies */}
        <Section icon={GitBranch} title="Dependencies">
          <div className="space-y-2 rounded-lg border p-3">
            <div className="text-xs font-medium text-muted-foreground">Predecessors (must finish first)</div>
            {task.predecessors.length === 0 && <p className="text-xs text-muted-foreground">None</p>}
            {task.predecessors.map((l) => (
              <div key={l.id} className="flex items-center justify-between text-sm">
                <span>
                  <span className="text-xs text-muted-foreground">{taskKey(projectKey, l.predecessor.taskNumber)}</span> {l.predecessor.title}
                  <Badge variant={taskStatusVariant(l.predecessor.status)} className="ml-2">{labelOf(l.predecessor.status)}</Badge>
                </span>
                {canEdit && <Button size="icon" variant="ghost" className="size-6" onClick={() => delDep.mutate(l.id)}><X className="size-3.5" /></Button>}
              </div>
            ))}
            {canEdit && (
              <Select value="" onValueChange={(v) => addDep.mutate(v)}>
                <SelectTrigger size="sm" className="w-full"><SelectValue placeholder="Add predecessor…" /></SelectTrigger>
                <SelectContent>
                  {depCandidates.map((t) => <SelectItem key={t.id} value={t.id}>{taskKey(projectKey, t.taskNumber)} {t.title}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            {task.successors.length > 0 && (
              <>
                <div className="pt-1 text-xs font-medium text-muted-foreground">Successors (blocked by this)</div>
                {task.successors.map((l) => (
                  <div key={l.id} className="text-sm">
                    <span className="text-xs text-muted-foreground">{taskKey(projectKey, l.successor.taskNumber)}</span> {l.successor.title}
                  </div>
                ))}
              </>
            )}
          </div>
        </Section>

        {/* Sub-tasks */}
        <Section icon={ListTree} title="Sub-tasks" count={task.subtasks.length}>
          <div className="space-y-1">
            {task.subtasks.map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded border px-2 py-1 text-sm">
                <span className="flex items-center gap-2">
                  {wbsById.get(s.id) && <span className="font-mono text-xs text-muted-foreground">{wbsById.get(s.id)}</span>}
                  {s.title}
                </span>
                <Badge variant={taskStatusVariant(s.status)}>{labelOf(s.status)}</Badge>
              </div>
            ))}
            {isAdmin && (
              <div className="flex gap-2">
                <Input
                  value={subtaskInput}
                  onChange={(e) => setSubtaskInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitSubtask(); } }}
                  placeholder="New sub-task title"
                  className="h-8"
                />
                <Button size="sm" variant="outline" onClick={submitSubtask}><Plus className="size-4" /></Button>
              </div>
            )}
          </div>
        </Section>

        {/* Comments */}
        <Section icon={MessageSquare} title="Comments" count={task.comments.length}>
          <div className="space-y-3">
            {task.comments.map((c) => (
              <div key={c.id} className="rounded-lg bg-muted/50 p-2.5">
                <div className="mb-0.5 flex items-center justify-between">
                  <span className="text-xs font-medium text-foreground">{c.authorName || 'Someone'}</span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    {new Date(c.createdAt).toLocaleString()}
                    <button type="button" onClick={() => delComment.mutate(c.id)}><Trash2 className="size-3.5 hover:text-destructive" /></button>
                  </span>
                </div>
                <p className="text-sm whitespace-pre-wrap text-foreground">{c.body}</p>
              </div>
            ))}
            <div className="flex gap-2">
              <Input
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitComment(); } }}
                placeholder="Add a comment… use @name to mention"
                className="h-9"
              />
              <Button size="sm" onClick={submitComment} disabled={!comment.trim()}>Post</Button>
            </div>
          </div>
        </Section>

        <DialogFooter className="items-center gap-2">
          <span className="mr-auto text-xs text-muted-foreground">Changes save automatically</span>
          <Button onClick={onClose}>Save &amp; close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
