import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import api from '../../../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

interface Task {
  id: string;
  title: string;
  status: string;
  assigneeUserId?: string | null;
  assigneeName?: string | null;
  dueDate?: string | null;
}
interface UserOption { id: string; username: string; }

export default function TasksTab({ ticketId }: { ticketId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState('');
  const [dueDate, setDueDate] = useState('');

  const { data: tasks = [] } = useQuery<Task[]>({
    queryKey: ['ticket-tasks', ticketId],
    queryFn: async () => (await api.get(`/api/tickets/${ticketId}/tasks`)).data,
  });
  const { data: users = [] } = useQuery<UserOption[]>({
    queryKey: ['users'],
    queryFn: async () => (await api.get('/api/users')).data,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['ticket-tasks', ticketId] });
    qc.invalidateQueries({ queryKey: ['ticket-activity', ticketId] });
  };
  const create = useMutation({
    mutationFn: () => api.post(`/api/tickets/${ticketId}/tasks`, {
      title,
      assigneeUserId: assignee || undefined,
      dueDate: dueDate || undefined,
    }),
    onSuccess: () => { invalidate(); setOpen(false); setTitle(''); setAssignee(''); setDueDate(''); },
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
    onSuccess: invalidate,
  });

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setOpen(true)}><Plus className="size-4" /> Add task</Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
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
          {tasks.map((t) => (
            <div key={t.id} className="flex items-center gap-3 py-2.5">
              <Checkbox
                checked={t.status === 'DONE'}
                onCheckedChange={(c) => patch.mutate({ taskId: t.id, data: { status: c ? 'DONE' : 'OPEN' } })}
              />
              <div className="min-w-0 flex-1">
                <div className={`text-sm ${t.status === 'DONE' ? 'text-muted-foreground line-through' : 'text-foreground'}`}>{t.title}</div>
                <div className="text-xs text-muted-foreground">
                  {t.assigneeName ?? 'Unassigned'}{t.dueDate ? ` · due ${new Date(t.dueDate).toLocaleDateString()}` : ''}
                </div>
              </div>
              <Button size="icon" variant="ghost" className="size-8 text-destructive hover:text-destructive" onClick={() => remove.mutate(t.id)}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
