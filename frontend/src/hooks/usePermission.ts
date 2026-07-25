import { useQuery } from '@tanstack/react-query';
import api from '../lib/api';
import { useAuth } from '../context/AuthContext';

type Permissions = Record<string, Record<string, boolean>>;

export function usePermission(formName: string) {
  const { isAuthenticated } = useAuth();

  const { data: permissions } = useQuery<Permissions>({
    queryKey: ['permissions'],
    queryFn: async () => {
      const res = await api.get('/api/auth/me/permissions');
      return res.data;
    },
    enabled: isAuthenticated,
    staleTime: 5 * 60 * 1000,
  });

  const formPerms = permissions?.[formName] ?? {};

  return {
    can: (action: string) => !!formPerms[`can${action.charAt(0).toUpperCase()}${action.slice(1)}`],
    canCreate: !!formPerms.canCreate,
    canUpdate: !!formPerms.canUpdate,
    canView: !!formPerms.canView,
    canDelete: !!formPerms.canDelete,
    canExport: !!formPerms.canExport,
    canImport: !!formPerms.canImport,
  };
}
