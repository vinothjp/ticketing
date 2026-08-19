import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Download } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../lib/api';
import { exportCsv } from '../../lib/exportCsv';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type {
  ClientVisit,
  CustomerCompanyOption,
  UserOption,
} from './clientVisitsMeta';
import {
  VISIT_STATUS_LABELS,
  statusVariant
} from './clientVisitsMeta';

export function ClientVisitsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Arriving from a client / product / ticket screen: those screens link here
  // with their own id, which stays applied until it's cleared.
  const contextProductId = searchParams.get('productId');
  const contextTicketId = searchParams.get('ticketId');
  const hasContext = !!(contextProductId || contextTicketId);

  const [filterCompany, setFilterCompany] = useState<string>(searchParams.get('customerCompanyId') ?? 'all');
  const [filterConsultant, setFilterConsultant] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const { data: customerCompanies = [] } = useQuery<CustomerCompanyOption[]>({
    queryKey: ['customer-companies'],
    queryFn: async () => {
      const res = await api.get('/api/customer-companies');
      return res.data;
    }
  });

  const { data: users = [] } = useQuery<UserOption[]>({
    queryKey: ['users'],
    queryFn: async () => {
      const res = await api.get('/api/users');
      return res.data;
    }
  });

  const queryParams = new URLSearchParams();
  if (filterCompany !== 'all') queryParams.append('customerCompanyId', filterCompany);
  if (filterConsultant !== 'all') queryParams.append('consultantId', filterConsultant);
  if (filterStatus !== 'all') queryParams.append('status', filterStatus);
  if (contextProductId) queryParams.append('productId', contextProductId);
  if (contextTicketId) queryParams.append('ticketId', contextTicketId);
  if (dateFrom) queryParams.append('from', dateFrom);
  if (dateTo) queryParams.append('to', dateTo);

  const { data: visits = [], isLoading } = useQuery<ClientVisit[]>({
    queryKey: ['client-visits', filterCompany, filterConsultant, filterStatus, dateFrom, dateTo, contextProductId, contextTicketId],
    queryFn: async () => {
      const res = await api.get(`/api/client-visits?${queryParams.toString()}`);
      return res.data;
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/api/client-visits/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client-visits'] });
      toast.success('Visit deleted successfully');
    },
    onError: () => {
      toast.error('Failed to delete visit');
    }
  });

  const handleDelete = (id: string) => {
    if (window.confirm('Are you sure you want to delete this visit?')) {
      deleteMutation.mutate(id);
    }
  };

  const handleExport = () => {
    exportCsv('client-visits.csv', visits, [
      { header: 'Visit #', value: (v) => v.visitNumber ?? '' },
      { header: 'Date', value: (v) => new Date(v.visitDate).toLocaleDateString() },
      { header: 'Client', value: (v) => v.customerCompany?.name ?? '' },
      { header: 'Consultant', value: (v) => v.consultantName ?? '' },
      { header: 'Product', value: (v) => v.productName ?? '' },
      { header: 'Hours', value: (v) => v.hours ?? 0 },
      { header: 'Status', value: (v) => VISIT_STATUS_LABELS[v.status] ?? v.status },
      { header: 'Purpose', value: (v) => v.purpose ?? '' },
    ]);
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Client Visits</h1>
          <p className="text-muted-foreground">Track client visits, hours, and interactions</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleExport}>
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>
          <Button onClick={() => navigate('/client-visits/new')}>
            <Plus className="mr-2 h-4 w-4" />
            New Visit
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Select value={filterCompany} onValueChange={setFilterCompany}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All Clients" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Clients</SelectItem>
            {customerCompanies.map(c => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterConsultant} onValueChange={setFilterConsultant}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All Consultants" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Consultants</SelectItem>
            {users.map(u => (
              <SelectItem key={u.id} value={u.id}>{u.username}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="PLANNED">Planned</SelectItem>
            <SelectItem value="VISITED">Visited</SelectItem>
            <SelectItem value="RESCHEDULED">Rescheduled</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="w-auto"
            title="Date From"
          />
          <span className="text-muted-foreground">-</span>
          <Input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="w-auto"
            title="Date To"
          />
        </div>

        {hasContext && (
          <Button variant="ghost" size="sm" onClick={() => setSearchParams({})}>
            Clear {contextProductId ? 'product' : 'ticket'} filter
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="text-muted-foreground">Loading...</div>
      ) : visits.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground border rounded-lg bg-muted/10">
          No client visits found. Create your first visit to get started.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left">
                <th className="px-3 py-2 font-medium">Visit #</th>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Client</th>
                <th className="px-3 py-2 font-medium">Consultant</th>
                <th className="px-3 py-2 font-medium">Product</th>
                <th className="px-3 py-2 font-medium">Hours</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Purpose</th>
                <th className="px-3 py-2 font-medium w-16"></th>
              </tr>
            </thead>
            <tbody>
              {visits.map(visit => (
                <tr key={visit.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-3 py-2">{visit.visitNumber || '-'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{new Date(visit.visitDate).toLocaleDateString()}</td>
                  <td className="px-3 py-2">{visit.customerCompany?.name}</td>
                  <td className="px-3 py-2">{visit.consultantName}</td>
                  <td className="px-3 py-2">{visit.productName || '-'}</td>
                  <td className="px-3 py-2">{visit.hours}</td>
                  <td className="px-3 py-2">
                    <Badge variant={statusVariant(visit.status)}>
                      {VISIT_STATUS_LABELS[visit.status]}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">
                    {visit.purpose.length > 50 ? `${visit.purpose.substring(0, 50)}...` : visit.purpose}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" onClick={() => navigate(`/client-visits/${visit.id}/edit`)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(visit.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
