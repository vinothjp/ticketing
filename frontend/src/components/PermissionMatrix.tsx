import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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

const ACTIONS: (keyof Omit<Permission, 'roleId' | 'formId'>)[] = [
  'canCreate', 'canUpdate', 'canView', 'canDelete', 'canExport', 'canImport',
];

const ACTION_LABELS: Record<string, string> = {
  canCreate: 'Create', canUpdate: 'Update', canView: 'View',
  canDelete: 'Delete', canExport: 'Export', canImport: 'Import',
};

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
  });

  const getPermission = (roleId: string, formId: string): Permission | undefined =>
    data?.permissions.find(p => p.roleId === roleId && p.formId === formId);

  const handleToggle = (
    roleId: string, formId: string,
    action: keyof Omit<Permission, 'roleId' | 'formId'>,
    current: boolean,
  ) => {
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
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-card px-3 py-2 text-left align-bottom text-muted-foreground">Form</th>
            {roles.map(role => (
              <th key={role.id} colSpan={5} className="border-b border-l px-3 py-2 text-center font-semibold text-foreground">
                {role.name}
              </th>
            ))}
          </tr>
          <tr>
            <th className="sticky left-0 z-10 bg-card px-3 py-2"></th>
            {roles.map(role =>
              ACTIONS.map(action => (
                <th key={`${role.id}-${action}`} className="border-b border-l px-2 py-1.5 text-center text-xs font-medium text-muted-foreground">
                  {ACTION_LABELS[action]}
                </th>
              ))
            )}
          </tr>
        </thead>
        <tbody>
          {forms.map((form, i) => (
            <tr key={form.id} className={cn(i % 2 === 1 && 'bg-muted/30')}>
              <td className="sticky left-0 z-10 bg-inherit px-3 py-2 font-medium text-foreground">{form.displayName}</td>
              {roles.map(role => {
                const perm = getPermission(role.id, form.id);
                return ACTIONS.map(action => {
                  const checked = perm?.[action] ?? false;
                  return (
                    <td key={`${role.id}-${form.id}-${action}`} className="border-l px-2 py-2 text-center">
                      <Checkbox
                        checked={checked}
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
