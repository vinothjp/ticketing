import { useEffect, useState } from 'react';
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
import { Combobox } from '@/components/ui/combobox';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useConfirm } from '@/hooks/useConfirm';
import {
  TASK_STATUSES, PRIORITIES, invalidateProject, labelOf, taskStatusVariant, taskKey,
  type TaskDetail, type ProjectTask, type ProjectResource, type UserOption,
} from '../projectMeta';
import AssigneeSelect from './AssigneeSelect';

const NONE = '__none__';
const toDateInput = (v?: string | null) => (v ? new Date(v).toISOString().slice(0, 10) : '');

// The task's own fields are a draft: nothing is written until Save, and closing the
// window any other way discards it. Comments and sub-tasks keep their own Post / +
// buttons, which act at once.
type Fields = {
  status: string;
  priority: string | null;
  assigneeUserId: string | null;
  startDate: string;
  dueDate: string;
  critical: boolean;
  description: string;
  tags: string[];
  watcherIds: string[];
  predecessorIds: string[];
};
const fieldsOf = (t: TaskDetail): Fields => ({
  status: t.status,
  priority: t.priority ?? null,
  assigneeUserId: t.assigneeUserId ?? null,
  startDate: toDateInput(t.startDate),
  dueDate: toDateInput(t.dueDate),
  critical: !!t.critical,
  description: t.description ?? '',
  tags: t.tags ?? [],
  watcherIds: t.watchers.map((w) => w.userId),
  predecessorIds: t.predecessors.map((l) => l.predecessor.id),
});
// Watchers and predecessors are sets — order is not a change.
const same = (a: unknown, b: unknown) =>
  Array.isArray(a) && Array.isArray(b)
    ? a.length === b.length && a.every((x) => b.includes(x))
    : JSON.stringify(a) === JSON.stringify(b);

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
  taskId, projectId, projectKey, users, tasks, projectStart, projectEnd, onClose, resources, onAddToResources,
}: {
  taskId: string | null;
  projectId: string;
  projectKey: string | null;
  users: UserOption[];
  tasks: ProjectTask[];
  projectStart?: string;
  projectEnd?: string;
  onClose: () => void;
  resources: ProjectResource[];
  onAddToResources: (userId: string) => void;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = !!user?.roles.includes('Admin');
  const myId = user?.id ?? null;
  const [comment, setComment] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [subtaskInput, setSubtaskInput] = useState('');
  // Only the fields the user has touched; everything else reads through to the saved
  // task, so a refetch (after posting a comment, say) never wipes an unsaved edit.
  const [edits, setEdits] = useState<Partial<Fields>>({});
  const [saving, setSaving] = useState(false);
  const { confirm, ConfirmDialog } = useConfirm();

  useEffect(() => {
    setEdits({});
    setComment('');
    setTagInput('');
    setSubtaskInput('');
  }, [taskId]);

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

  const addComment = useMutation(mut(() => api.post(`/api/projects/tasks/${taskId}/comments`, { body: comment.trim() }), 'Comment added'));
  const delComment = useMutation({ mutationFn: (id: string) => api.delete(`/api/projects/task-comments/${id}`), onSuccess: invalidate });
  const addSubtask = useMutation(mut(() => api.post(`/api/projects/${projectId}/tasks`, { title: subtaskInput.trim(), parentTaskId: taskId }), 'Sub-task added'));

  if (!task) {
    return (
      <Dialog open={!!taskId} onOpenChange={(o) => !o && onClose()}>
        <DialogContent><p className="text-muted-foreground">Loading...</p></DialogContent>
      </Dialog>
    );
  }

  const saved = fieldsOf(task);
  const draft: Fields = { ...saved, ...edits };
  const set = <K extends keyof Fields>(k: K, v: Fields[K]) => setEdits((e) => ({ ...e, [k]: v }));
  const changed = (Object.keys(edits) as (keyof Fields)[]).filter((k) => !same(edits[k], saved[k]));
  const dirty = changed.length > 0;

  // Close by any route other than Save: ask before throwing an edit away.
  const requestClose = async () => {
    if (saving) return;
    if (dirty && !(await confirm({
      title: 'Discard unsaved changes?',
      description: 'Your changes to this task have not been saved.',
      confirmText: 'Discard', cancelText: 'Keep editing', destructive: true,
    }))) return;
    onClose();
  };

  const save = async () => {
    if (!dirty) { onClose(); return; }
    setSaving(true);
    try {
      const patch: Record<string, unknown> = {};
      for (const k of changed) {
        if (k === 'watcherIds' || k === 'predecessorIds') continue;
        if (k === 'startDate' || k === 'dueDate') patch[k] = draft[k] || undefined;
        else if (k === 'assigneeUserId') patch[k] = draft.assigneeUserId || null;
        else patch[k] = draft[k];
      }
      if (Object.keys(patch).length) await api.patch(`/api/projects/tasks/${taskId}`, patch);
      // Link changes one at a time, so a refused one names itself and the rest still land.
      for (const uid of draft.watcherIds.filter((x) => !saved.watcherIds.includes(x))) {
        await api.post(`/api/projects/tasks/${taskId}/watchers`, { userId: uid });
      }
      for (const uid of saved.watcherIds.filter((x) => !draft.watcherIds.includes(x))) {
        await api.delete(`/api/projects/tasks/${taskId}/watchers/${uid}`);
      }
      for (const pid of draft.predecessorIds.filter((x) => !saved.predecessorIds.includes(x))) {
        await api.post(`/api/projects/tasks/${taskId}/dependencies`, { predecessorId: pid });
      }
      for (const link of task.predecessors.filter((l) => !draft.predecessorIds.includes(l.predecessor.id))) {
        await api.delete(`/api/projects/dependencies/${link.id}`);
      }
      invalidate();
      setEdits({});
      toast.success('Task saved');
      onClose();
    } catch (e: any) {
      // Whatever did land is refetched; the edits stay so the user can correct and retry.
      invalidate();
      toast.error(e.response?.data?.message || 'Error saving task');
    } finally {
      setSaving(false);
    }
  };

  const canEdit = isAdmin || task.assigneeUserId === myId;
  // A summary item's status is derived from its sub-tasks on the server, never set here.
  const isSummary = task.subtasks.length > 0;
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
  const tags = draft.tags;
  const watcherIds = new Set(draft.watcherIds);
  const predIds = new Set(draft.predecessorIds);
  const depCandidates = tasks.filter((t) => t.id !== task.id && !predIds.has(t.id));
  // A watcher or predecessor picked in this session isn't on the saved task yet, so its
  // label comes from the user / task lists the dialog already has.
  const watcherName = (uid: string) =>
    task.watchers.find((w) => w.userId === uid)?.user.username ?? users.find((u) => u.id === uid)?.username ?? uid;
  const predecessorOf = (pid: string) => {
    const t = task.predecessors.find((l) => l.predecessor.id === pid)?.predecessor ?? tasks.find((x) => x.id === pid);
    return t ? { taskNumber: t.taskNumber, title: t.title, status: t.status } : null;
  };

  const submitComment = () => { if (comment.trim()) addComment.mutate(undefined, { onSuccess: () => setComment('') }); };
  const submitTag = () => {
    const t = tagInput.trim();
    if (t && !tags.includes(t)) set('tags', [...tags, t]);
    setTagInput('');
  };
  const removeTag = (t: string) => set('tags', tags.filter((x) => x !== t));
  const submitSubtask = () => { if (subtaskInput.trim()) addSubtask.mutate(undefined, { onSuccess: () => setSubtaskInput('') }); };

  return (
    <Dialog open={!!taskId} onOpenChange={(o) => { if (!o) void requestClose(); }}>
      {/* Pinned header carrying Save over a scrolling body, so Save is in reach however far down you are. */}
      <DialogContent showCloseButton={false} className="flex max-h-[86vh] max-w-3xl flex-col gap-0 overflow-hidden p-0">
        <div className="flex items-center gap-3 border-b px-6 py-3">
          <DialogTitle className="flex min-w-0 flex-1 items-center gap-2">
            {myWbs && <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-normal text-muted-foreground">{myWbs}</span>}
            <span className="shrink-0 text-xs font-normal text-muted-foreground">{taskKey(projectKey, task.taskNumber)}</span>
            <span className="truncate" title={task.title}>{task.title}</span>
            {!canEdit && <Badge variant="outline" className="ml-1 shrink-0 font-normal">View only</Badge>}
          </DialogTitle>
          {dirty && <span className="shrink-0 text-xs text-amber-600">Unsaved changes</span>}
          {canEdit ? (
            <>
              <Button size="sm" variant="outline" className="shrink-0" onClick={() => void requestClose()} disabled={saving}>Cancel</Button>
              <Button size="sm" className="shrink-0" onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save & close'}</Button>
            </>
          ) : (
            <Button size="sm" variant="outline" className="shrink-0" onClick={onClose}>Close</Button>
          )}
        </div>

        <div className="grid flex-1 gap-4 overflow-y-auto px-6 py-4">
        {/* Properties */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <div className="mb-1 text-xs text-muted-foreground">
              Status{isSummary && <span title="Set from its sub-tasks"> · follows sub-tasks</span>}
            </div>
            <Select value={draft.status} onValueChange={(v) => { if (v) set('status', v); }} disabled={!canEdit || isSummary}>
              <SelectTrigger size="sm" className="w-full"><Badge variant={taskStatusVariant(draft.status)}>{labelOf(draft.status)}</Badge></SelectTrigger>
              <SelectContent>{TASK_STATUSES.map((s) => <SelectItem key={s} value={s}>{labelOf(s)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <div className="mb-1 text-xs text-muted-foreground">Priority</div>
            <Select value={draft.priority ?? NONE} onValueChange={(v) => { if (v) set('priority', v === NONE ? null : v); }} disabled={!canEdit}>
              <SelectTrigger size="sm" className="w-full"><SelectValue placeholder="None" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>None</SelectItem>
                {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{labelOf(p)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <div className="mb-1 text-xs text-muted-foreground">Assignee</div>
            <AssigneeSelect
              size="sm" disabled={!canEdit} users={users} resources={resources} onAddToResources={onAddToResources}
              value={draft.assigneeUserId ?? ''} onChange={(uid) => set('assigneeUserId', uid || null)}
            />
          </div>
          <div>
            <div className="mb-1 text-xs text-muted-foreground">Start date</div>
            <DateField disabled={!canEdit} value={draft.startDate} min={pMin} max={earliest(draft.dueDate || undefined, pMax)} onChange={(v) => set('startDate', v)} />
          </div>
          <div>
            <div className="mb-1 text-xs text-muted-foreground">End date</div>
            <DateField disabled={!canEdit} value={draft.dueDate} min={latest(draft.startDate, pMin)} max={pMax} onChange={(v) => set('dueDate', v)} />
          </div>
        </div>

        {/* Critical path flag (shows the ⚡ marker in the WBS) */}
        <label className="flex w-fit items-center gap-2 text-sm">
          <Checkbox checked={draft.critical} disabled={!canEdit} onCheckedChange={(v) => set('critical', !!v)} />
          <span className="flex items-center gap-1"><Zap className="size-3.5 text-destructive" /> Critical path</span>
        </label>

        {/* Description */}
        <Section icon={FileText} title="Description">
          <Textarea
            rows={3}
            readOnly={!canEdit}
            value={draft.description}
            placeholder={canEdit ? 'Add a short summary of this task…' : 'No description'}
            onChange={(e) => set('description', e.target.value)}
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
        <Section icon={Eye} title="Watchers" count={draft.watcherIds.length}>
          <div className="flex flex-wrap items-center gap-2">
            {draft.watcherIds.map((uid) => (
              <Badge key={uid} variant="outline" className="gap-1">
                {watcherName(uid)}
                {canEdit && <button type="button" onClick={() => set('watcherIds', draft.watcherIds.filter((x) => x !== uid))}><X className="size-3" /></button>}
              </Badge>
            ))}
            {draft.watcherIds.length === 0 && <span className="text-xs text-muted-foreground">None</span>}
            {canEdit && (
              <Combobox
                size="sm" className="w-40" placeholder="Add watcher" emptyText="No matching user"
                value=""
                onChange={(v) => { if (v && !watcherIds.has(v)) set('watcherIds', [...draft.watcherIds, v]); }}
                options={users.filter((u) => !watcherIds.has(u.id)).map((u) => ({ value: u.id, label: u.username }))}
              />
            )}
          </div>
        </Section>

        {/* Dependencies */}
        <Section icon={GitBranch} title="Dependencies">
          <div className="space-y-2 rounded-lg border p-3">
            <div className="text-xs font-medium text-muted-foreground">Predecessors (must finish first)</div>
            {draft.predecessorIds.length === 0 && <p className="text-xs text-muted-foreground">None</p>}
            {draft.predecessorIds.map((pid) => {
              const p = predecessorOf(pid);
              return (
                <div key={pid} className="flex items-center justify-between text-sm">
                  <span>
                    {p && <span className="text-xs text-muted-foreground">{taskKey(projectKey, p.taskNumber)}</span>} {p?.title ?? pid}
                    {p && <Badge variant={taskStatusVariant(p.status)} className="ml-2">{labelOf(p.status)}</Badge>}
                  </span>
                  {canEdit && <Button size="icon" variant="ghost" className="size-6" onClick={() => set('predecessorIds', draft.predecessorIds.filter((x) => x !== pid))}><X className="size-3.5" /></Button>}
                </div>
              );
            })}
            {canEdit && (
              <Select value="" onValueChange={(v) => { if (v && !predIds.has(v)) set('predecessorIds', [...draft.predecessorIds, v]); }}>
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
        </div>
      </DialogContent>
      {ConfirmDialog}
    </Dialog>
  );
}
