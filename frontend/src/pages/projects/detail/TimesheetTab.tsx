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
import { Combobox } from '@/components/ui/combobox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { invalidateProject, wbsOrder, type ProjectDetail, type UserOption } from '../projectMeta';
import { useAuth } from '../../../context/AuthContext';

const tsVariant = (s: string): 'success' | 'destructive' | 'secondary' =>
  s === 'APPROVED' ? 'success' : s === 'REJECTED' ? 'destructive' : 'secondary';

export default function TimesheetTab({ project }: { project: ProjectDetail; users: UserOption[] }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = !!user?.roles.includes('Admin');
  // Only a Resources member with a cost category may log time — their hours are costed at that rate.
  const members = project.resources
    .filter((r) => r.userId && r.categoryId)
    .map((r) => ({ id: r.userId as string, username: r.user?.username ?? r.consultantName ?? '—' }));
  // What time is logged against: the project's leaf tasks and subtasks, in WBS order —
  // never a phase, milestone or item with children (the server applies the same rule).
  const parents = new Set(project.tasks.map((t) => t.parentTaskId).filter(Boolean));
  const loggable: { id: string; label: string; phase: string | null }[] = [];
  let top: string | null = null;
  for (const { task, depth } of wbsOrder(project.tasks)) {
    if (depth === 0) top = task.title;
    if (parents.has(task.id) || task.wbsType === 'PHASE' || task.wbsType === 'MILESTONE') continue;
    loggable.push({ id: task.id, label: `${task.wbsCode ? `${task.wbsCode} ` : ''}${task.title}`, phase: depth ? top : null });
  }
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState(() => (members.some((m) => m.id === user?.id) ? user!.id : ''));
  // Time is logged inside the project's window; the picker blocks every day outside it,
  // and the default (today) is pulled into the window when the project isn't running today.
  const projStart = project.startDate ? new Date(project.startDate).toISOString().slice(0, 10) : undefined;
  const projEnd = project.endDate ? new Date(project.endDate).toISOString().slice(0, 10) : undefined;
  const clampToProject = (d: string) => (projStart && d < projStart ? projStart : projEnd && d > projEnd ? projEnd : d);
  const [date, setDate] = useState(() => clampToProject(new Date().toISOString().slice(0, 10)));
  const [taskId, setTaskId] = useState('');
  const [hours, setHours] = useState('8');
  const [work, setWork] = useState('');
  const invalidate = () => invalidateProject(qc);

  const add = useMutation({
    mutationFn: () => api.post(`/api/projects/${project.id}/timesheets`, {
      userId,
      consultantName: members.find((m) => m.id === userId)?.username,
      date, taskId, hours: Number(hours) || 0, workPerformed: work || undefined,
    }),
    onSuccess: () => { invalidate(); setOpen(false); setTaskId(''); setHours('8'); setWork(''); toast.success('Timesheet logged'); },
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
                <Combobox
                  placeholder="Select consultant"
                  emptyText={members.length ? 'No matching member' : 'No member on Resources'}
                  value={userId}
                  onChange={(v) => { if (v) setUserId(v); }}
                  options={members.map((m) => ({ value: m.id, label: m.username }))}
                />
                {members.length === 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">Add people on the Resources tab first.</p>
                )}
              </div>
              <div>
                <div className="mb-1 text-sm">Date</div>
                <DateField value={date} min={projStart} max={projEnd} onChange={(v) => setDate(v)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="mb-1 text-sm">Activity</div>
                <Combobox
                  maxRows={5} placement="below" placeholder="Select task"
                  emptyText={loggable.length ? 'No matching task' : 'No task on this project'}
                  value={taskId}
                  onChange={(v) => { if (v) setTaskId(v); }}
                  options={loggable.map((t) => ({ value: t.id, label: t.label, hint: t.phase }))}
                />
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
          <DialogFooter><Button disabled={add.isPending || !userId || !taskId} onClick={() => add.mutate()}>Log</Button></DialogFooter>
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
                    {isAdmin && t.status !== 'APPROVED' && (
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
