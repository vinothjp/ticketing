import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import api from '../../../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useWorklogs } from './ticketQueries';
import type { Task } from './TasksTab';

const today = () => new Date().toISOString().slice(0, 10);
/** Radix cannot hold an empty value, so "no task" needs a sentinel of its own. */
const NO_TASK = '__none__';

/**
 * The time list and its Log time dialog, living at the foot of the Tasks tab —
 * time and the work it was spent on read better together than in the separate
 * tab this used to be. The dialog is opened from the Tasks header, so its state
 * is the caller's.
 */
export default function WorklogSection({
  ticketId,
  tasks,
  logOpen,
  onLogOpenChange,
}: {
  ticketId: string;
  /** This ticket's tasks, to offer as the optional link. */
  tasks: Task[];
  logOpen: boolean;
  onLogOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const [hours, setHours] = useState('');
  const [workDate, setWorkDate] = useState(today());
  const [note, setNote] = useState('');
  const [taskId, setTaskId] = useState(NO_TASK);

  const { data: logs = [] } = useWorklogs(ticketId);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['ticket-worklogs', ticketId] });
    // The ticket carries the running total the header chip shows.
    qc.invalidateQueries({ queryKey: ['tickets', ticketId] });
    // Logged time changes the customer's support-hours usage — the ticket header's
    // pool chip, the ticket form's "hrs spent" field and the My Products pools all
    // read it, so keep clearing these even though this list shows no balance.
    qc.invalidateQueries({ queryKey: ['support-usage'] });
    qc.invalidateQueries({ queryKey: ['ticket-support-hours'] });
    qc.invalidateQueries({ queryKey: ['my-products'] });
    qc.invalidateQueries({ queryKey: ['my-product-contract'] });
  };
  const create = useMutation({
    mutationFn: () => api.post(`/api/tickets/${ticketId}/worklogs`, {
      hours: Number(hours),
      workDate: workDate || undefined,
      note: note.trim() || undefined,
      taskId: taskId === NO_TASK ? undefined : taskId,
    }),
    onSuccess: () => {
      invalidate();
      onLogOpenChange(false);
      setHours(''); setWorkDate(today()); setNote(''); setTaskId(NO_TASK);
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error logging time'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/tickets/${ticketId}/worklogs/${id}`),
    onSuccess: invalidate,
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error removing entry'),
  });

  return (
    <div className="space-y-3">
      <Dialog open={logOpen} onOpenChange={onLogOpenChange}>
        <DialogContent>
          <DialogHeader><DialogTitle>Log time</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Hours</label>
                <Input type="number" min={0} step="0.25" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="e.g. 1.5" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Date</label>
                <Input type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} />
              </div>
            </div>
            {/* Optional: which task the hours went on. The entry is charged to
                the ticket either way — this only says what it was for. */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Task <span className="font-normal text-muted-foreground">(optional)</span></label>
              <Select value={taskId} onValueChange={(v) => { if (v) setTaskId(v); }}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Not linked to a task" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_TASK}>Not linked to a task</SelectItem>
                  {tasks.map((t) => <SelectItem key={t.id} value={t.id}>{t.title}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Note <span className="font-normal text-muted-foreground">(optional)</span></label>
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did you work on?" />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => create.mutate()} disabled={!(Number(hours) > 0) || create.isPending}>
              {create.isPending ? 'Saving…' : 'Log time'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {logs.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No time logged yet — use <span className="font-medium text-foreground">Log time</span> above.
        </p>
      ) : (
        <div className="divide-y border-y">
          {logs.map((l) => (
            <div key={l.id} className="flex items-start gap-3 py-2.5">
              <div className="w-16 shrink-0 text-sm font-semibold text-foreground">{Number(l.hours)} h</div>
              <div className="min-w-0 flex-1">
                <div className="text-xs text-muted-foreground">
                  {new Date(l.workDate).toLocaleDateString()}{l.consultantName ? ` · ${l.consultantName}` : ''}
                </div>
                {l.taskTitle && (
                  <div className="text-xs text-muted-foreground">
                    on <span className="font-medium text-foreground">{l.taskTitle}</span>
                  </div>
                )}
                {l.note && <div className="text-sm text-foreground">{l.note}</div>}
              </div>
              <Button size="icon" variant="ghost" className="size-8 text-destructive hover:text-destructive" onClick={() => remove.mutate(l.id)}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
