import { useQuery } from '@tanstack/react-query';
import { Users, KeyRound, ShieldCheck, UserCheck, Building2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../lib/api';
import { assetUrl } from '@/lib/assetUrl';
import KpiCard, { type Kpi } from '@/components/KpiCard';

interface UserRow { id: string; isActive: boolean; }
interface RoleRow { id: string; }
interface PermissionMatrix { forms: { id: string }[] }
interface MyClient { name: string; logoUrl: string | null; }

export default function DashboardPage() {
  const { user } = useAuth();

  const { data: myClient } = useQuery<MyClient | null>({
    queryKey: ['my-client'],
    queryFn: async () => (await api.get('/api/auth/me/client')).data,
  });
  const { data: users = [] } = useQuery<UserRow[]>({
    queryKey: ['users'],
    queryFn: async () => (await api.get('/api/users')).data,
  });
  const { data: roles = [] } = useQuery<RoleRow[]>({
    queryKey: ['roles'],
    queryFn: async () => (await api.get('/api/roles')).data,
  });
  const { data: matrix } = useQuery<PermissionMatrix>({
    queryKey: ['permission-matrix'],
    queryFn: async () => (await api.get('/api/permissions/matrix')).data,
  });

  const kpis: Kpi[] = [
    { label: 'Total Users', icon: Users, color: '#4F46E5', value: users.length, route: '/users' },
    { label: 'Active Users', icon: UserCheck, color: '#16A34A', value: users.filter((u) => u.isActive).length, route: '/users' },
    { label: 'Roles', icon: KeyRound, color: '#0EA5E9', value: roles.length, route: '/roles' },
    { label: 'Protected Modules', icon: ShieldCheck, color: '#F59E0B', value: matrix?.forms.length ?? 0, route: '/roles' },
  ];

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-foreground">Dashboard</h1>

      {myClient && (
        <div className="mb-6 flex items-center gap-4 rounded-xl border bg-card p-4">
          {myClient.logoUrl ? (
            <img src={assetUrl(myClient.logoUrl)!} alt={myClient.name} className="size-14 rounded-lg border object-cover" />
          ) : (
            <div className="flex size-14 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Building2 className="size-7" />
            </div>
          )}
          <div>
            <div className="text-lg font-semibold text-foreground">{myClient.name}</div>
            <div className="text-sm text-muted-foreground">
              Welcome back, <strong className="text-foreground">{user?.username}</strong>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <KpiCard key={kpi.label} kpi={kpi} />
        ))}
      </div>
    </div>
  );
}
