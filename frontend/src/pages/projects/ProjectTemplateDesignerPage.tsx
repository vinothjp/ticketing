import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Trash2, GripVertical } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const WBS_TYPES = ['PHASE', 'TASK', 'SUBTASK', 'ACTIVITY', 'CHECKLIST', 'MILESTONE'];

interface BTask { title: string; wbsType: string; durationDays: number }
interface BMilestone { name: string; tasks: BTask[] }
interface TemplateData {
  name: string;
  description?: string | null;
  category?: string | null;
  blueprint: { milestones?: { name: string; tasks?: { title: string; wbsType?: string; durationDays?: number }[] }[] };
}

export default function ProjectTemplateDesignerPage() {
  const { id } = useParams<{ id: string }>();
  const editing = !!id;
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [milestones, setMilestones] = useState<BMilestone[]>([]);

  const { data } = useQuery<TemplateData>({
    queryKey: ['project-templates', id],
    queryFn: async () => (await api.get(`/api/project-templates/${id}`)).data,
    enabled: editing,
  });

  useEffect(() => {
    if (!data) return;
    setName(data.name);
    setCategory(data.category ?? '');
    setDescription(data.description ?? '');
    setMilestones((data.blueprint?.milestones ?? []).map((m) => ({
      name: m.name,
      tasks: (m.tasks ?? []).map((t) => ({ title: t.title, wbsType: t.wbsType ?? 'TASK', durationDays: t.durationDays ?? 1 })),
    })));
  }, [data]);

  // ---- milestone / task editing ----
  const addMilestone = () => setMilestones((ms) => [...ms, { name: '', tasks: [] }]);
  const removeMilestone = (mi: number) => setMilestones((ms) => ms.filter((_, i) => i !== mi));
  const setMilestoneName = (mi: number, v: string) => setMilestones((ms) => ms.map((m, i) => (i === mi ? { ...m, name: v } : m)));
  const addTask = (mi: number) => setMilestones((ms) => ms.map((m, i) => (i === mi ? { ...m, tasks: [...m.tasks, { title: '', wbsType: 'TASK', durationDays: 1 }] } : m)));
  const removeTask = (mi: number, ti: number) => setMilestones((ms) => ms.map((m, i) => (i === mi ? { ...m, tasks: m.tasks.filter((_, j) => j !== ti) } : m)));
  const setTask = (mi: number, ti: number, patch: Partial<BTask>) =>
    setMilestones((ms) => ms.map((m, i) => (i === mi ? { ...m, tasks: m.tasks.map((t, j) => (j === ti ? { ...t, ...patch } : t)) } : m)));

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: name.trim(),
        category: category.trim() || undefined,
        description: description.trim() || undefined,
        blueprint: {
          milestones: milestones
            .filter((m) => m.name.trim())
            .map((m) => ({
              name: m.name.trim(),
              tasks: m.tasks.filter((t) => t.title.trim()).map((t) => ({ title: t.title.trim(), wbsType: t.wbsType, durationDays: Math.max(1, Number(t.durationDays) || 1) })),
            })),
        },
      };
      return editing ? api.put(`/api/project-templates/${id}`, payload) : api.post('/api/project-templates', payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project-templates'] });
      toast.success(editing ? 'Template saved' : 'Template created');
      navigate('/admin/project-templates');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error saving template'),
  });

  const totalTasks = milestones.reduce((n, m) => n + m.tasks.length, 0);

  return (
    <div className="max-w-3xl">
      <Button variant="ghost" size="sm" className="mb-4" onClick={() => navigate('/admin/project-templates')}>
        <ArrowLeft className="size-4" /> Back to templates
      </Button>

      <h1 className="mb-1 text-2xl font-bold text-foreground">{editing ? 'Edit project template' : 'New project template'}</h1>
      <p className="mb-6 text-sm text-muted-foreground">Define the milestones and tasks (WBS). Creating a project from this template scaffolds them, with dates rolled forward from the project start date.</p>

      <Card className="mb-6">
        <CardHeader><CardTitle className="text-sm">Template details</CardTitle></CardHeader>
        <CardContent className="space-y-4 pb-6">
          <div className="grid grid-cols-2 gap-3">
            <div><div className="mb-1 text-sm">Name</div><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Software Delivery" /></div>
            <div><div className="mb-1 text-sm">Category</div><Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Software" /></div>
          </div>
          <div><div className="mb-1 text-sm">Description</div><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What kind of project this template is for…" /></div>
        </CardContent>
      </Card>

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-foreground">Work breakdown</h2>
        <span className="text-sm text-muted-foreground">{milestones.length} milestone{milestones.length === 1 ? '' : 's'} · {totalTasks} task{totalTasks === 1 ? '' : 's'}</span>
      </div>

      <div className="space-y-4">
        {milestones.map((m, mi) => (
          <Card key={mi}>
            <CardContent className="space-y-3 py-4">
              <div className="flex items-center gap-2">
                <GripVertical className="size-4 shrink-0 text-muted-foreground" />
                <Input className="font-medium" value={m.name} onChange={(e) => setMilestoneName(mi, e.target.value)} placeholder={`Milestone ${mi + 1} name`} />
                <Button size="icon" variant="ghost" className="size-8 shrink-0 text-destructive hover:text-destructive" onClick={() => removeMilestone(mi)}><Trash2 className="size-4" /></Button>
              </div>

              <div className="space-y-2 pl-6">
                {m.tasks.map((t, ti) => (
                  <div key={ti} className="flex items-center gap-2">
                    <Input className="flex-1" value={t.title} onChange={(e) => setTask(mi, ti, { title: e.target.value })} placeholder="Task title" />
                    <Select value={t.wbsType} onValueChange={(v) => setTask(mi, ti, { wbsType: v })}>
                      <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                      <SelectContent>{WBS_TYPES.map((w) => <SelectItem key={w} value={w}>{w.charAt(0) + w.slice(1).toLowerCase()}</SelectItem>)}</SelectContent>
                    </Select>
                    <div className="flex items-center gap-1">
                      <Input type="number" min={1} className="w-16" value={t.durationDays} onChange={(e) => setTask(mi, ti, { durationDays: Number(e.target.value) })} />
                      <span className="text-xs text-muted-foreground">days</span>
                    </div>
                    <Button size="icon" variant="ghost" className="size-8 shrink-0 text-destructive hover:text-destructive" onClick={() => removeTask(mi, ti)}><Trash2 className="size-4" /></Button>
                  </div>
                ))}
                <Button size="sm" variant="outline" onClick={() => addTask(mi)}><Plus className="size-3.5" /> Add task</Button>
              </div>
            </CardContent>
          </Card>
        ))}

        <Button variant="outline" onClick={addMilestone}><Plus className="size-4" /> Add milestone</Button>
      </div>

      <div className="mt-6 flex gap-2">
        <Button disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : editing ? 'Save template' : 'Create template'}
        </Button>
        <Button variant="outline" onClick={() => navigate('/admin/project-templates')}>Cancel</Button>
      </div>
    </div>
  );
}
