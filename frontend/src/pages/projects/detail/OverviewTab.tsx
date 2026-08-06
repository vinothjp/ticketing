import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ListChecks, Flag, Users, Ticket as TicketIcon } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../../lib/api';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { invalidateProject, milestoneStatusVariant, labelOf, type ProjectDetail } from '../projectMeta';

function Stat({ icon: Icon, value, label, color }: { icon: typeof ListChecks; value: number | string; label: string; color: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 py-5">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl" style={{ background: `${color}1a`, color }}>
          <Icon className="size-5" />
        </div>
        <div>
          <div className="text-2xl font-bold text-foreground">{value}</div>
          <div className="text-sm text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function OverviewTab({ project }: { project: ProjectDetail }) {
  const qc = useQueryClient();
  const [description, setDescription] = useState(project.description ?? '');

  useEffect(() => { setDescription(project.description ?? ''); }, [project.description]);

  const saveMutation = useMutation({
    mutationFn: () => api.patch(`/api/projects/${project.id}`, { description }),
    onSuccess: () => { invalidateProject(qc); toast.success('Saved'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error saving'),
  });
  const approveMutation = useMutation({
    mutationFn: (v: { id: string; approvalStatus: string }) => api.patch(`/api/projects/milestones/${v.id}`, { approvalStatus: v.approvalStatus }),
    onSuccess: () => invalidateProject(qc),
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error updating approval'),
  });
  const approvalVariant = (s?: string): 'success' | 'destructive' | 'secondary' =>
    (s === 'APPROVED' ? 'success' : s === 'REJECTED' ? 'destructive' : 'secondary');

  const taskCount = project.tasks.length;
  const doneCount = project.tasks.filter((t) => t.status === 'COMPLETED').length;
  const milestoneCount = project.milestones.length;
  const dirty = description !== (project.description ?? '');

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat icon={ListChecks} value={`${doneCount}/${taskCount}`} label="Tasks done" color="#6366f1" />
        <Stat icon={Flag} value={milestoneCount} label="Milestones" color="#f59e0b" />
        <Stat icon={Users} value={project.resources.length} label="Team" color="#10b981" />
        <Stat icon={TicketIcon} value={project.tickets.length} label="Linked tickets" color="#0ea5e9" />
      </div>

      {/* Milestone progress (Excel stage gates) */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Milestones</CardTitle></CardHeader>
        <CardContent className="space-y-2.5 pb-5">
          {project.milestones.length === 0 && <p className="text-sm text-muted-foreground">No milestones.</p>}
          {project.milestones.map((m) => (
            <div key={m.id} className="flex items-center gap-3">
              <span className="w-44 shrink-0 truncate text-sm text-foreground">{m.name}</span>
              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-primary" style={{ width: `${m.progress ?? 0}%` }} />
              </div>
              <span className="w-10 text-right text-sm tabular-nums text-muted-foreground">{m.progress ?? 0}%</span>
              <Badge variant={milestoneStatusVariant(m.status)} className="w-24 justify-center">{labelOf(m.status)}</Badge>
              <Select value={m.approvalStatus ?? 'PENDING'} onValueChange={(v) => approveMutation.mutate({ id: m.id, approvalStatus: v })}>
                <SelectTrigger size="sm" className="w-32" title="Stage-gate sign-off">
                  <Badge variant={approvalVariant(m.approvalStatus)}>{labelOf(m.approvalStatus ?? 'PENDING')}</Badge>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PENDING">Pending</SelectItem>
                  <SelectItem value="APPROVED">Approved</SelectItem>
                  <SelectItem value="REJECTED">Rejected</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-medium text-foreground">Overall progress</div>
            <div className="text-sm text-muted-foreground">{project.progress}%</div>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary" style={{ width: `${project.progress}%` }} />
          </div>
        </CardContent>
      </Card>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-medium text-foreground">Description</div>
          <Button size="sm" disabled={!dirty || saveMutation.isPending} onClick={() => saveMutation.mutate()}>
            {saveMutation.isPending ? 'Saving...' : 'Save'}
          </Button>
        </div>
        <Textarea
          rows={6}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe this project..."
        />
      </div>
    </div>
  );
}
