import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../../lib/api';
import { Button } from '@/components/ui/button';
import { DateField } from '@/components/ui/date-field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { invalidateProject, type ProjectDetail, type UserOption } from '../projectMeta';

const NONE = '__none__';
const tsVariant = (s: string): 'success' | 'destructive' | 'secondary' =>
  s === 'APPROVED' ? 'success' : s === 'REJECTED' ? 'destructive' : 'secondary';

export default function TimesheetTab({ project, users }: { project: ProjectDetail; users: UserOption[] }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [activity, setActivity] = useState('');
  const [hours, setHours] = useState('8');
  const [work, setWork] = useState('');
  const invalidate = () => invalidateProject(qc);

  const add = useMutation({
    mutationFn: () => api.post(`/api/projects/${project.id}/timesheets`, {
      userId: userId || undefined,
      consultantName: userId ? users.find((u) => u.id === userId)?.username : undefined,
      date, activity: activity || undefined, hours: Number(hours) || 0, workPerformed: work || undefined,
    }),
    onSuccess: () => { invalidate(); setOpen(false); setActivity(''); setHours('8'); setWork(''); toast.success('Timesheet logged'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.patch(`/api/projects/timesheets/${id}`, { status }),
    onSuccess: invalidate,
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/api/projects/timesheets/${id}`),
    onSuccess: () => { invalidate(); toast.success('Removed'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  });

  const total = project.timesheets.reduce((s, t) => s + Number(t.hours), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{project.timesheets.length} entr{project.timesheets.length === 1 ? 'y' : 'ies'} · {total} hours logged</span>
        <Button size="sm" onClick={() => setOpen(true)}><Plus className="size-4" /> Log Time</Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Log time</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="mb-1 text-sm">Consultant</div>
                <Select value={userId || NONE} onValueChange={(v) => setUserId(v === NONE ? '' : v)}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Me" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Me</SelectItem>
                    {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.username}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <div className="mb-1 text-sm">Date</div>
                <DateField value={date} onChange={(v) => setDate(v)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="mb-1 text-sm">Activity</div>
                <Input value={activity} onChange={(e) => setActivity(e.target.value)} placeholder="e.g. UAT" />
              </div>
              <div>
                <div className="mb-1 text-sm">Hours</div>
                <Input type="number" min={0} step="0.5" value={hours} onChange={(e) => setHours(e.target.value)} />
              </div>
            </div>
            <div>
              <div className="mb-1 text-sm">Work performed</div>
              <Textarea rows={2} value={work} onChange={(e) => setWork(e.target.value)} />
            </div>
          </div>
          <DialogFooter><Button disabled={add.isPending} onClick={() => add.mutate()}>Log</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="overflow-x-auto border-t">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Consultant</TableHead>
              <TableHead>Activity</TableHead>
              <TableHead className="text-right">Hours</TableHead>
              <TableHead>Work performed</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {project.timesheets.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No time logged.</TableCell></TableRow>}
            {project.timesheets.map((t) => (
              <TableRow key={t.id}>
                <TableCell>{new Date(t.date).toLocaleDateString()}</TableCell>
                <TableCell>{t.user?.username || t.consultantName || '—'}</TableCell>
                <TableCell>{t.activity || '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{Number(t.hours)}</TableCell>
                <TableCell className="max-w-xs truncate text-muted-foreground">{t.workPerformed || '—'}</TableCell>
                <TableCell><Badge variant={tsVariant(t.status)}>{t.status}</Badge></TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    {t.status !== 'APPROVED' && (
                      <Button size="sm" variant="outline" className="h-8" onClick={() => setStatus.mutate({ id: t.id, status: 'APPROVED' })} title="Approve">
                        <CheckCircle2 className="size-4" />
                      </Button>
                    )}
                    <Button size="sm" variant="destructive" onClick={() => del.mutate(t.id)}><Trash2 className="size-4" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
