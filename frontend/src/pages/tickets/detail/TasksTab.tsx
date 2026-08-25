import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2, Clock, MessageSquare } from 'lucide-react';
import api from '../../../lib/api';
import { useAuth } from '../../../context/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import WorklogSection from './WorklogSection';
import { useWorklogs } from './ticketQueries';
import TicketTaskDialog from './TicketTaskDialog';
import { TASK_STATUSES, hrs, isSettledTask } from './taskMeta';

export interface Task {
  id: string;
  title: string;
  status: string;
  assigneeUserId?: string | null;
  assigneeName?: string | null;
  dueDate?: string | null;
  hoursSpent?: number | string | null;
  commentCount?: number;
}
export interface UserOption { id: string; username: string; }

export default function TasksTab({ ticketId }: { ticketId: string }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [addOpen, setAddOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  // Which task's detail dialog is up. Null closes it.
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState('');
  const [dueDate, setDueDate] = useState('');

  // Only the consultant a task belongs to moves its status; a tenant admin may
  // correct one. Same rule the backend enforces, mirrored here so the control is
  // simply disabled rather than bouncing off a 403.
  const isAdmin = !!user?.roles.includes('Admin');
  const mayTrack = (t: Task) => isAdmin || (!!t.assigneeUserId && t.assigneeUserId === user?.id);

  const { data: tasks = [] } = useQuery<Task[]>({
    queryKey: ['ticket-tasks', ticketId],
    queryFn: async () => (await api.get(`/api/tickets/${ticketId}/tasks`)).data,
  });
  const { data: users = [] } = useQuery<UserOption[]>({
    queryKey: ['users'],
    queryFn: async () => (await api.get('/api/users')).data,
  });
  const { data: logs = [] } = useWorklogs(ticketId);
  const loggedHours = logs.reduce((sum, l) => sum + Number(l.hours), 0);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['ticket-tasks', ticketId] });
    qc.invalidateQueries({ queryKey: ['ticket-task'] });
    qc.invalidateQueries({ queryKey: ['ticket-activity', ticketId] });
    // Task time is audit only and charges nothing, but the ticket's open-task
    // count gates resolving it, so the ticket itself still has to be refetched.
    qc.invalidateQueries({ queryKey: ['tickets', ticketId] });
  };
  const create = useMutation({
    mutationFn: () => api.post(`/api/tickets/${ticketId}/tasks`, {
      title,
      assigneeUserId: assignee || undefined,
      dueDate: dueDate || undefined,
    }),
    onSuccess: () => { invalidate(); setAddOpen(false); setTitle(''); setAssignee(''); setDueDate(''); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error adding task'),
  });
  const patch = useMutation({
    mutationFn: ({ taskId, data }: { taskId: string; data: Record<string, unknown> }) =>
      api.patch(`/api/tickets/${ticketId}/tasks/${taskId}`, data),
    onSuccess: invalidate,
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error updating task'),
  });
  const remove = useMutation({
    mutationFn: (taskId: string) => api.delete(`/api/tickets/${ticketId}/tasks/${taskId}`),
    onSuccess: () => { invalidate(); setOpenTaskId(null); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error removing task'),
  });

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="size-4" />
            <span><span className="font-semibold text-foreground">{loggedHours}</span> hours logged on this ticket</span>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setLogOpen(true)}>
              <Plus className="size-4" /> Log time
            </Button>
            <Button size="sm" onClick={() => setAddOpen(true)}><Plus className="size-4" /> Add task</Button>
          </div>
        </div>

        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Add task</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Title</label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Order replacement part" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Assignee</label>
                  <Select value={assignee || undefined} onValueChange={setAssignee}>
                    <SelectTrigger className="w-full"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                    <SelectContent>
                      {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.username}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Due date</label>
                  <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => create.mutate()} disabled={!title.trim() || create.isPending}>Add</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tasks yet.</p>
        ) : (
          <div className="divide-y border-y">
            {tasks.map((t) => {
              const canTrack = mayTrack(t);
              const hours = Number(t.hoursSpent ?? 0);
              return (
                // The row opens the task's detail dialog. It carries its own
                // controls, so it is a div with a button role rather than a
                // <button> — a button cannot nest one.
                <div
                  key={t.id}
                  role="button"
                  tabIndex={0}
                  className="flex cursor-pointer items-start gap-3 py-2.5 hover:bg-muted/40"
                  onClick={() => setOpenTaskId(t.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenTaskId(t.id); } }}
                >
                  {/* The status is the task's clock: every change is stamped, and
                      the trail is what the dialog shows as its audit. Stop the
                      click here, or picking a status also pops the dialog. */}
                  <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                    <Select
                      value={t.status}
                      disabled={!canTrack}
                      onValueChange={(v) => { if (v && v !== t.status) patch.mutate({ taskId: t.id, data: { status: v } }); }}
                    >
                      <SelectTrigger size="sm" className="w-36">
                        <SelectValue placeholder="Status" />
                      </SelectTrigger>
                      <SelectContent>
                        {TASK_STATUSES.map((s) => (
                          <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="min-w-0 flex-1 space-y-1">
                    <div className={`text-sm ${isSettledTask(t.status) ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                      {t.title}
                      {t.status === 'CANCELLED' && <span className="ml-2 text-xs no-underline">(cancelled)</span>}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      <span>{t.assigneeName ?? 'Unassigned'}</span>
                      {t.dueDate && <span>· due {new Date(t.dueDate).toLocaleDateString()}</span>}
                      {hours > 0 && (
                        <span title="Time this task stood in progress — audit only, not charged to the contract">
                          · <span className="font-semibold text-foreground">{hrs(hours)}</span>
                        </span>
                      )}
                      {!!t.commentCount && (
                        <span className="flex items-center gap-1">
                          · <MessageSquare className="size-3" />{t.commentCount}
                        </span>
                      )}
                    </div>
                  </div>

                  <Button
                    size="icon" variant="ghost" className="size-8 text-destructive hover:text-destructive"
                    title="Delete task"
                    onClick={(e) => { e.stopPropagation(); remove.mutate(t.id); }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Time is logged by hand and lives with the work it was spent on — this is
          the whole of what used to be the Time tab. */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-foreground">Time logged</h3>
        <WorklogSection ticketId={ticketId} tasks={tasks} logOpen={logOpen} onLogOpenChange={setLogOpen} />
      </div>

      <TicketTaskDialog
        ticketId={ticketId}
        taskId={openTaskId}
        users={users}
        canTrack={(t) => mayTrack(t)}
        onClose={() => setOpenTaskId(null)}
        onDelete={(taskId) => remove.mutate(taskId)}
      />
    </div>
  );
}
