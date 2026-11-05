import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Pencil, Trash2, Copy, LayoutTemplate } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
        /* The same row list the ticket Templates screen uses: an icon tile, the
           name with its category, one muted line of detail, the active switch and
           three ghost icon actions. The counts that were their own columns read
           better as part of that detail line. */
        <div className="divide-y border-y">
          {templates.map((t) => {
            const c = counts(t);
            return (
              <div key={t.id} className="flex items-center gap-4 py-3.5">
                <div
                  className="flex size-10 shrink-0 items-center justify-center rounded-lg"
                  style={{ backgroundColor: 'color-mix(in srgb, var(--color-primary) 10%, transparent)', color: 'var(--color-primary)' }}
                >
                  <LayoutTemplate className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Link to={`/admin/project-templates/${t.id}`} className="truncate font-medium text-foreground hover:underline">
                      {t.name}
                    </Link>
                    {t.category && <Badge variant="secondary">{t.category}</Badge>}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {c.milestones} milestone{c.milestones === 1 ? '' : 's'} · {c.tasks} task{c.tasks === 1 ? '' : 's'}
                    {t.description ? ` · ${t.description}` : ''}
                  </div>
                </div>
                <label className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
                  <Switch
                    checked={t.isActive}
                    onCheckedChange={(v) => toggle.mutate({ id: t.id, isActive: v })}
                  />
                  {t.isActive ? 'Active' : 'Inactive'}
                </label>
                <div className="flex shrink-0 gap-1">
                  <Button size="icon" variant="ghost" title="Edit" asChild>
                    <Link to={`/admin/project-templates/${t.id}`}><Pencil className="size-4" /></Link>
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    title="Duplicate"
                    disabled={clone.isPending}
                    onClick={() => clone.mutate(t)}
                  >
                    <Copy className="size-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    title="Delete"
                    className="text-destructive hover:text-destructive"
                    onClick={async () => {
                      if (await confirm({ title: `Delete ${t.name}?`, destructive: true, confirmText: 'Delete' })) remove.mutate(t.id);
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
