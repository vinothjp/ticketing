import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Download,
  Hash, Calendar, Building2, AtSign, Package, Timer, CircleDot, AlignLeft } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { VisitReportDialog } from './VisitReportDialog';
import { exportCsv } from '../../lib/exportCsv';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type {
  ClientVisit,
  CustomerCompanyOption,
  UserOption,
} from './clientVisitsMeta';
import {
  VISIT_STATUS_LABELS,
  statusPill,
  needsNewDate,
  wasRescheduled
} from './clientVisitsMeta';

/**
 * A column heading: its icon, then its label. Muted and small, so the headings
 * read as chrome and the values below them carry the weight. Mirrors the task
 * grid on the ticket detail screen.
 */
function HeadLabel({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
      <Icon className="size-3.5 shrink-0" />
      {children}
    </span>
  );
}

export function ClientVisitsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  // Admins plan visits for everyone; a consultant only ever sees their own and
  // reports back on them, so the whole toolbar collapses to a status filter.
  const isAdmin = !!user?.roles.includes('Admin');

  // Arriving from a client / product / ticket screen: those screens link here
  // with their own id, which stays applied until it's cleared.
  const openVisitId = searchParams.get('visit');   // deep link from the bell
  const contextProductId = searchParams.get('productId');
  const contextTicketId = searchParams.get('ticketId');
  const hasContext = !!(contextProductId || contextTicketId);

  const [filterCompany, setFilterCompany] = useState<string>(searchParams.get('customerCompanyId') ?? 'all');
  const [filterConsultant, setFilterConsultant] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Both only feed the admin-only filters, and `/api/customer-companies` is
  // Admin-guarded — a consultant must not fire them at all.
  const { data: customerCompanies = [] } = useQuery<CustomerCompanyOption[]>({
    queryKey: ['customer-companies'],
    enabled: isAdmin,
    queryFn: async () => {
      const res = await api.get('/api/customer-companies');
      return res.data;
    }
  });

  const { data: users = [] } = useQuery<UserOption[]>({
    queryKey: ['users'],
    enabled: isAdmin,
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

  // A notification links straight at one visit; open its report dialog once the
  // list has arrived, then drop the param so a later close doesn't re-open it.
  const [reportVisitId, setReportVisitId] = useState<string | null>(null);
  useEffect(() => {
    if (!openVisitId || !visits.length) return;
    if (visits.some((v) => v.id === openVisitId)) setReportVisitId(openVisitId);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('visit');
      return next;
    }, { replace: true });
  }, [openVisitId, visits]);
  const reportVisit = visits.find((v) => v.id === reportVisitId) ?? null;

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
          <p className="text-muted-foreground">
            {isAdmin
              ? 'Track client visits, hours, and interactions'
              : 'Visits assigned to you — confirm the hours and report the outcome'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleExport}>
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>
          {isAdmin && (
            <Button onClick={() => navigate('/client-visits/new')}>
              <Plus className="mr-2 h-4 w-4" />
              New Visit
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {isAdmin && (
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
        )}

        {isAdmin && (
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
        )}

        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="PLANNED">Planned</SelectItem>
            <SelectItem value="VISITED">Visited</SelectItem>
            <SelectItem value="RESCHEDULE_REQUESTED">Reschedule requested</SelectItem>
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
          {isAdmin
            ? 'No client visits found. Create your first visit to get started.'
            : 'No client visits are assigned to you yet.'}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="border-r"><HeadLabel icon={Hash}>Visit #</HeadLabel></TableHead>
                {/* Status carries the longest label on the row ("Reschedule
                    requested", plus a "Rescheduled" marker), so it takes 10% back
                    from Date and 5% from Hours — both of which hold short, fixed
                    content and were over-wide for it. */}
                <TableHead className="w-[10%] border-r"><HeadLabel icon={Calendar}>Date</HeadLabel></TableHead>
                <TableHead className="border-r"><HeadLabel icon={Building2}>Client</HeadLabel></TableHead>
                {isAdmin && <TableHead className="border-r"><HeadLabel icon={AtSign}>Consultant</HeadLabel></TableHead>}
                <TableHead className="border-r"><HeadLabel icon={Package}>Product</HeadLabel></TableHead>
                <TableHead className="w-[5%] border-r"><HeadLabel icon={Timer}>Hours</HeadLabel></TableHead>
                <TableHead className="w-[15%] border-r"><HeadLabel icon={CircleDot}>Status</HeadLabel></TableHead>
                <TableHead className="border-r"><HeadLabel icon={AlignLeft}>Purpose</HeadLabel></TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visits.map(visit => (
                <TableRow key={visit.id}>
                  <TableCell className="border-r">
                    {visit.visitNumber
                      ? <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{visit.visitNumber}</code>
                      : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="border-r whitespace-nowrap">
                    <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-foreground">
                      {new Date(visit.visitDate).toLocaleDateString()}
                    </span>
                  </TableCell>
                  <TableCell className="border-r">
                    <span className="block max-w-[11rem] truncate" title={visit.customerCompany?.name}>
                      {visit.customerCompany?.name}
                    </span>
                  </TableCell>
                  {isAdmin && (
                    <TableCell className="border-r">
                      {visit.consultantName ? (
                        <span className="flex items-center gap-2">
                          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
                            {visit.consultantName.slice(0, 2).toUpperCase()}
                          </span>
                          <span className="block max-w-[8rem] truncate text-foreground" title={visit.consultantName}>
                            {visit.consultantName}
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  )}
                  <TableCell className="border-r">
                    {visit.productName
                      ? <span className="block max-w-[10rem] truncate" title={visit.productName}>{visit.productName}</span>
                      : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="border-r tabular-nums">{visit.hours}</TableCell>
                  <TableCell className="border-r">
                    <div className="flex flex-wrap items-center gap-1">
                      <span className={`rounded px-1.5 py-0.5 text-xs font-bold uppercase ${statusPill(visit.status)}`}>
                        {VISIT_STATUS_LABELS[visit.status] ?? visit.status}
                      </span>
                      {/* Where it is now, plus what it has been through — a re-dated
                          visit is a normal planned visit that happens to have slipped. */}
                      {wasRescheduled(visit) && (
                        <Badge variant="warning">
                          Rescheduled{(visit.rescheduleCount ?? 0) > 1 ? ` ${visit.rescheduleCount}×` : ''}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="border-r whitespace-normal">
                    <span className="block max-w-[14rem] truncate" title={visit.purpose}>{visit.purpose}</span>
                  </TableCell>
                  <TableCell>
                    {isAdmin ? (
                      <div className="flex items-center gap-1">
                        {/* A consultant can move a visit to Rescheduled but never
                            set its date — that's the admin's call (see
                            CONSULTANT_EDITABLE). Spell the next step out rather
                            than leaving a bare pencil on a row that needs one. */}
                        {needsNewDate(visit) ? (
                          <Button variant="outline" size="sm" className="whitespace-nowrap" onClick={() => navigate(`/client-visits/${visit.id}/edit`)}>
                            Set new date
                          </Button>
                        ) : (
                          <Button variant="ghost" size="icon" className="size-8" title="Edit visit" onClick={() => navigate(`/client-visits/${visit.id}/edit`)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" className="size-8" title="Delete visit" onClick={() => handleDelete(visit.id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    ) : (
                      <Button variant="outline" size="sm" onClick={() => setReportVisitId(visit.id)}>
                        {visit.status === 'PLANNED' ? 'Report' : 'Update'}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <VisitReportDialog visit={reportVisit} onClose={() => setReportVisitId(null)} />
    </div>
  );
}
