import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, Building2, CheckCircle2, Clock, Users, AlertTriangle } from 'lucide-react';
import api from '../../lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import KpiCard, { type Kpi } from '@/components/KpiCard';

interface License { plan: string; maxUsers: number; expiryDate: string; status: 'ACTIVE' | 'EXPIRED' | 'CANCELLED'; }
interface ClientRow {
  id: string;
  name: string;
  code: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'TRIAL';
  license: License | null;
  _count: { users: number };
}

const statusVariant: Record<ClientRow['status'], 'success' | 'destructive' | 'secondary'> = {
  ACTIVE: 'success',
  SUSPENDED: 'destructive',
  TRIAL: 'secondary',
};

export default function ClientsPage() {
  const navigate = useNavigate();

  const { data: clients = [], isLoading } = useQuery<ClientRow[]>({
    queryKey: ['super-admin-clients'],
    queryFn: async () => (await api.get('/api/super-admin/clients')).data,
  });

  const in30Days = Date.now() + 30 * 24 * 60 * 60 * 1000;
  const expiringSoon = clients.filter(
    (c) => c.license?.status === 'ACTIVE' && new Date(c.license.expiryDate).getTime() <= in30Days,
  ).length;

  const kpis: Kpi[] = [
    { label: 'Total Clients', icon: Building2, color: '#4F46E5', value: clients.length, route: '/platform/clients' },
    { label: 'Active', icon: CheckCircle2, color: '#16A34A', value: clients.filter((c) => c.status === 'ACTIVE').length, route: '/platform/clients' },
    { label: 'Trial / Suspended', icon: Clock, color: '#F59E0B', value: clients.filter((c) => c.status !== 'ACTIVE').length, route: '/platform/clients' },
    { label: 'Total Users', icon: Users, color: '#0EA5E9', value: clients.reduce((sum, c) => sum + c._count.users, 0), route: '/platform/clients' },
    { label: 'Licenses Expiring Soon', icon: AlertTriangle, color: '#DC2626', value: expiringSoon, route: '/platform/clients' },
  ];

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Clients</h1>
        <Button onClick={() => navigate('/platform/clients/new')}>
          <Plus className="size-4" /> New Client
        </Button>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        {kpis.map((kpi) => (
          <KpiCard key={kpi.label} kpi={kpi} />
        ))}
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : (
        <div className="border-t">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>License</TableHead>
                <TableHead>Seats</TableHead>
                <TableHead>Expiry</TableHead>
                <TableHead>Users</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clients.map((c) => (
                <TableRow
                  key={c.id}
                  className="cursor-pointer"
                  onClick={() => navigate(`/platform/clients/${c.id}`)}
                >
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell><code className="rounded bg-muted px-1.5 py-0.5 text-xs">{c.code}</code></TableCell>
                  <TableCell><Badge variant={statusVariant[c.status]}>{c.status}</Badge></TableCell>
                  <TableCell>{c.license?.plan ?? '—'}</TableCell>
                  <TableCell>{c.license ? `${c._count.users}/${c.license.maxUsers}` : '—'}</TableCell>
                  <TableCell>{c.license ? new Date(c.license.expiryDate).toLocaleDateString() : '—'}</TableCell>
                  <TableCell>{c._count.users}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
