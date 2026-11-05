import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '../lib/api';
import { cn } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';

interface Role { id: string; name: string; }
interface AppForm { id: string; name: string; displayName: string; }
interface Permission {
  roleId: string; formId: string;
  canCreate: boolean; canUpdate: boolean;
  canView: boolean; canDelete: boolean;
  canExport: boolean; canImport: boolean;
}

type Action = keyof Omit<Permission, 'roleId' | 'formId'>;

const ACTIONS: Action[] = [
  'canCreate', 'canUpdate', 'canView', 'canDelete', 'canExport', 'canImport',
];

const ACTION_LABELS: Record<Action, string> = {
  canCreate: 'Create', canUpdate: 'Update', canView: 'View',
  canDelete: 'Delete', canExport: 'Export', canImport: 'Import',
};

/**
 * The first column is `sticky left-0`, so the checkbox cells scroll underneath
 * it. That only reads as a panel if its background is **opaque** — a
 * translucent `bg-muted/30` (or a `bg-inherit` over an unstyled row) lets the
 * matrix show straight through, which is why the zebra striping is gone and
 * every sticky cell paints `bg-card`. Rows are separated by a border instead.
 */
const STICKY_CELL = 'sticky left-0 z-20 bg-card';

export default function PermissionMatrix() {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<{ roles: Role[]; forms: AppForm[]; permissions: Permission[] }>({
    queryKey: ['permission-matrix'],
    queryFn: async () => (await api.get('/api/permissions/matrix')).data,
  });

  const upsertMutation = useMutation({
    mutationFn: (dto: Partial<Permission> & { roleId: string; formId: string }) =>
      api.post('/api/permissions', dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['permission-matrix'] }),
    onError: (e: any) => toast.error(e.response?.data?.message || 'Could not save permission'),
  });

  const getPermission = (roleId: string, formId: string): Permission | undefined =>
    data?.permissions.find(p => p.roleId === roleId && p.formId === formId);

  const handleToggle = (roleId: string, formId: string, action: Action, current: boolean) => {
    const existing = getPermission(roleId, formId);
    upsertMutation.mutate({
      roleId, formId,
      canCreate: existing?.canCreate ?? false,
      canUpdate: existing?.canUpdate ?? false,
      canView: existing?.canView ?? false,
      canDelete: existing?.canDelete ?? false,
      canExport: existing?.canExport ?? false,
      canImport: existing?.canImport ?? false,
      [action]: !current,
    });
  };

  if (isLoading) return <p className="text-muted-foreground">Loading...</p>;
  if (!data) return null;

  const { roles, forms } = data;

  if (roles.length === 0) {
    return <p className="text-sm text-muted-foreground">Create a role first to configure its permissions.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-muted/50">
            <th className={cn(STICKY_CELL, 'border-b border-r px-3 py-2 text-left align-bottom text-xs font-semibold text-muted-foreground')}>
              Form
            </th>
            {roles.map(role => (
              <th
                key={role.id}
                colSpan={ACTIONS.length}
                className="border-b border-l-2 px-3 py-2 text-center font-semibold whitespace-nowrap text-foreground"
              >
                {role.name}
              </th>
            ))}
          </tr>
          <tr className="bg-muted/50">
            <th className={cn(STICKY_CELL, 'border-b border-r')}></th>
            {roles.map(role =>
              ACTIONS.map((action, i) => (
                <th
                  key={`${role.id}-${action}`}
                  className={cn(
                    'border-b px-2 py-1.5 text-center text-xs font-medium whitespace-nowrap text-muted-foreground',
                    i === 0 ? 'border-l-2' : 'border-l',
                  )}
                >
                  {ACTION_LABELS[action]}
                </th>
              ))
            )}
          </tr>
        </thead>
        <tbody>
          {forms.map(form => (
            <tr key={form.id} className="border-t">
              <td className={cn(STICKY_CELL, 'border-r px-3 py-2 font-medium whitespace-nowrap text-foreground')}>
                {form.displayName}
              </td>
              {roles.map(role => {
                const perm = getPermission(role.id, form.id);
                return ACTIONS.map((action, i) => {
                  const checked = perm?.[action] ?? false;
                  return (
                    <td
                      key={`${role.id}-${form.id}-${action}`}
                      className={cn('px-2 py-2 text-center', i === 0 ? 'border-l-2' : 'border-l')}
                    >
                      <Checkbox
                        checked={checked}
                        aria-label={`${ACTION_LABELS[action]} ${form.displayName} as ${role.name}`}
                        onCheckedChange={() => handleToggle(role.id, form.id, action, checked)}
                      />
                    </td>
                  );
                });
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
