import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Plus, Pencil, Trash2, Copy, LayoutTemplate } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Switch } from '@/components/ui/switch';
import { useConfirm } from '@/hooks/useConfirm';

interface BlueprintTask { title: string; wbsType?: string; durationDays?: number }
interface BlueprintMilestone { name: string; tasks?: BlueprintTask[] }
interface ProjectTemplate {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  isActive: boolean;
  blueprint: { milestones?: BlueprintMilestone[] };
}

export default function ProjectTemplatesListPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { confirm, ConfirmDialog } = useConfirm();

  const { data: templates = [], isLoading } = useQuery<ProjectTemplate[]>({
    queryKey: ['project-templates'],
    queryFn: async () => (await api.get('/api/project-templates')).data,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['project-templates'] });

  const toggle = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => api.put(`/api/project-templates/${id}`, { isActive }),
    onSuccess: invalidate,
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error updating template'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/project-templates/${id}`),
    onSuccess: () => { invalidate(); toast.success('Template deleted'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error deleting template'),
  });

  // Names are unique per tenant — find a free "(copy)" variant.
  const cloneName = (base: string) => {
    const names = new Set(templates.map((t) => t.name));
    let candidate = `${base} (copy)`;
    let n = 2;
    while (names.has(candidate)) candidate = `${base} (copy ${n++})`;
    return candidate;
  };
  const clone = useMutation({
    mutationFn: (t: ProjectTemplate) => api.post('/api/project-templates', {
      name: cloneName(t.name),
      description: t.description || undefined,
      category: t.category || undefined,
      blueprint: t.blueprint,
    }),
    onSuccess: () => { invalidate(); toast.success('Template duplicated'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error duplicating template'),
  });

  const counts = (t: ProjectTemplate) => {
    const ms = t.blueprint?.milestones ?? [];
    return { milestones: ms.length, tasks: ms.reduce((n, m) => n + (m.tasks?.length ?? 0), 0) };
  };

  return (
    <div>
      {ConfirmDialog}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Project Templates</h1>
          <p className="text-sm text-muted-foreground">Reusable WBS blueprints. Pick one when creating a project to scaffold its milestones and tasks.</p>
        </div>
        <Button onClick={() => navigate('/admin/project-templates/new')}><Plus className="size-4" /> New template</Button>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : templates.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-12 text-center">
          <LayoutTemplate className="size-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No project templates yet.</p>
          <Button onClick={() => navigate('/admin/project-templates/new')}><Plus className="size-4" /> Create your first template</Button>
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Milestones</TableHead>
                  <TableHead>Tasks</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {templates.map((t) => {
                  const c = counts(t);
                  return (
                    <TableRow key={t.id}>
                      <TableCell>
                        <div className="font-medium text-foreground">{t.name}</div>
                        {t.description && <div className="text-xs text-muted-foreground">{t.description}</div>}
                      </TableCell>
                      <TableCell>{t.category ? <Badge variant="secondary">{t.category}</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell>{c.milestones}</TableCell>
                      <TableCell>{c.tasks}</TableCell>
                      <TableCell>
                        <Switch checked={t.isActive} onCheckedChange={(v) => toggle.mutate({ id: t.id, isActive: v })} />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="outline" onClick={() => clone.mutate(t)} disabled={clone.isPending}><Copy className="size-4" /> Duplicate</Button>
                          <Button size="sm" variant="outline" onClick={() => navigate(`/admin/project-templates/${t.id}`)}><Pencil className="size-4" /> Edit</Button>
                          <Button size="sm" variant="destructive"
                            onClick={async () => { if (await confirm({ title: `Delete ${t.name}?`, destructive: true, confirmText: 'Delete' })) remove.mutate(t.id); }}>
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
