import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2, Clock } from 'lucide-react';
import api from '../../../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

interface Worklog {
  id: string;
  hours: number | string;
  workDate: string;
  note?: string | null;
  consultantName?: string | null;
}

const today = () => new Date().toISOString().slice(0, 10);

export default function WorklogTab({ ticketId }: { ticketId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [hours, setHours] = useState('');
  const [workDate, setWorkDate] = useState(today());
  const [note, setNote] = useState('');

  const { data: logs = [] } = useQuery<Worklog[]>({
    queryKey: ['ticket-worklogs', ticketId],
    queryFn: async () => (await api.get(`/api/tickets/${ticketId}/worklogs`)).data,
  });
  const total = logs.reduce((sum, l) => sum + Number(l.hours), 0);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['ticket-worklogs', ticketId] });
    // Logged time changes the customer's support-hours usage.
    qc.invalidateQueries({ queryKey: ['support-usage'] });
  };
  const create = useMutation({
    mutationFn: () => api.post(`/api/tickets/${ticketId}/worklogs`, {
      hours: Number(hours),
      workDate: workDate || undefined,
      note: note.trim() || undefined,
    }),
    onSuccess: () => { invalidate(); setOpen(false); setHours(''); setWorkDate(today()); setNote(''); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error logging time'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/tickets/${ticketId}/worklogs/${id}`),
    onSuccess: invalidate,
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error removing entry'),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Clock className="size-4" />
          <span><span className="font-semibold text-foreground">{total}</span> hours logged on this ticket</span>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}><Plus className="size-4" /> Log time</Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
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
        <p className="text-sm text-muted-foreground">No time logged yet.</p>
      ) : (
        <div className="divide-y border-y">
          {logs.map((l) => (
            <div key={l.id} className="flex items-start gap-3 py-2.5">
              <div className="w-16 shrink-0 text-sm font-semibold text-foreground">{Number(l.hours)} h</div>
              <div className="min-w-0 flex-1">
                <div className="text-xs text-muted-foreground">
                  {new Date(l.workDate).toLocaleDateString()}{l.consultantName ? ` · ${l.consultantName}` : ''}
                </div>
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
