import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Pencil, Copy, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { iconFor } from './templateMeta';

interface TemplateSummary {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  icon: string | null;
  color: string | null;
  isActive: boolean;
  fieldCount: number;
  ticketCount: number;
}

export default function TemplatesListPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data: templates = [], isLoading } = useQuery<TemplateSummary[]>({
    queryKey: ['templates'],
    queryFn: async () => (await api.get('/api/templates')).data,
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.put(`/api/templates/${id}`, { isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error updating template'),
  });

  const duplicate = useMutation({
    mutationFn: async (id: string) => {
      const full = (await api.get(`/api/templates/${id}`)).data;
      return api.post('/api/templates', {
        name: `${full.name} (copy)`,
        category: full.category,
        description: full.description,
        descriptionGuidance: full.descriptionGuidance,
        icon: full.icon,
        color: full.color,
        defaultPriority: full.defaultPriority,
        isActive: false,
        fields: full.fields.map((f: any) => ({
          ...(f.isCustom ? {} : { fieldKey: f.fieldKey }),
          isCustom: f.isCustom,
          label: f.label,
          dataType: f.dataType,
          group: f.group,
          placeholder: f.placeholder,
          options: f.options,
          visibility: f.visibility,
          requirement: f.requirement,
          readOnly: f.readOnly,
          sortOrder: f.sortOrder,
          helperTextOverride: f.helperTextOverride,
        })),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['templates'] });
      toast.success('Template duplicated');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error duplicating template'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/templates/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['templates'] });
      toast.success('Template deleted');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error deleting template'),
  });

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Templates</h1>
          <p className="text-sm text-muted-foreground">
            Design the ticket forms your team fills in. Every active template appears in the New ticket dropdown.
          </p>
        </div>
        <Button onClick={() => navigate('/admin/templates/new')}>
          <Plus className="size-4" /> New template
        </Button>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : templates.length === 0 ? (
        <div className="py-16 text-center">
          <p className="font-medium text-foreground">No templates yet</p>
          <p className="mb-4 text-sm text-muted-foreground">Create your first template to start raising tickets.</p>
          <Button onClick={() => navigate('/admin/templates/new')}>
            <Plus className="size-4" /> New template
          </Button>
        </div>
      ) : (
        <div className="divide-y border-y">
          {templates.map((t) => {
            const Icon = iconFor(t.icon);
            const color = t.color ?? 'var(--color-primary)';
            return (
              <div key={t.id} className="flex items-center gap-4 py-3.5">
                <div
                  className="flex size-10 shrink-0 items-center justify-center rounded-lg"
                  style={{ backgroundColor: `${color}1a`, color }}
                >
                  <Icon className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Link to={`/admin/templates/${t.id}`} className="truncate font-medium text-foreground hover:underline">
                      {t.name}
                    </Link>
                    {t.category && <Badge variant="secondary">{t.category}</Badge>}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {t.fieldCount} field{t.fieldCount === 1 ? '' : 's'}{t.description ? ` · ${t.description}` : ''}
                  </div>
                </div>
                <label className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
                  <Switch
                    checked={t.isActive}
                    onCheckedChange={(checked) => toggleActive.mutate({ id: t.id, isActive: checked })}
                  />
                  {t.isActive ? 'Active' : 'Inactive'}
                </label>
                <div className="flex shrink-0 gap-1">
                  <Button size="icon" variant="ghost" title="Edit" asChild>
                    <Link to={`/admin/templates/${t.id}`}><Pencil className="size-4" /></Link>
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    title="Duplicate"
                    disabled={duplicate.isPending}
                    onClick={() => duplicate.mutate(t.id)}
                  >
                    <Copy className="size-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    title="Delete"
                    className="text-destructive hover:text-destructive"
                    onClick={() => {
                      if (confirm(`Delete "${t.name}"? This can't be undone.`)) remove.mutate(t.id);
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
