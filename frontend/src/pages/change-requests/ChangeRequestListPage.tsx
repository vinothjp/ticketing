import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useConfirm } from '@/hooks/useConfirm';
import { cn } from '@/lib/utils';
import {
  crStatusVariant, crPriorityVariant, crApprovalMeta, fmtDate, crOptionsQuery,
  type ChangeRequestSummary, type CrOption,
} from './changeRequestMeta';

const PAGE_SIZE = 10;

// A clickable summary tile that toggles the status filter.
function StatCard({ label, value, active, onClick }: { label: string; value: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'min-w-24 rounded-lg border px-4 py-3 text-left transition-colors',
        active ? 'border-primary bg-primary/5' : 'hover:bg-muted/50',
      )}
    >
      <div className="text-2xl font-bold text-foreground">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </button>
  );
}

export default function ChangeRequestListPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { confirm, ConfirmDialog } = useConfirm();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [page, setPage] = useState(1);

  const { data: crs = [], isLoading } = useQuery<ChangeRequestSummary[]>({
    queryKey: ['change-requests', 'all'],
    queryFn: async () => (await api.get('/api/change-requests')).data,
  });
  const { data: statusOpts = [] } = useQuery<CrOption[]>(crOptionsQuery('status'));
  const { data: priorityOpts = [] } = useQuery<CrOption[]>(crOptionsQuery('priority'));

  useEffect(() => { setPage(1); }, [search, statusFilter, priorityFilter]);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/change-requests/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['change-requests'] }); toast.success('Change request deleted'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error deleting change request'),
  });

  // Counts by status across the whole dataset (independent of the active filters),
  // so the summary stays a stable overview.
  const statusCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of crs) m.set(c.status, (m.get(c.status) ?? 0) + 1);
    return m;
  }, [crs]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return crs.filter((c) => {
      const matchesSearch = !term
        || c.crNumber.toLowerCase().includes(term)
        || c.title.toLowerCase().includes(term)
        || (c.customer ?? '').toLowerCase().includes(term)
        || (c.projectName ?? '').toLowerCase().includes(term);
      const matchesStatus = statusFilter === 'all' || c.status === statusFilter;
      const matchesPriority = priorityFilter === 'all' || c.priority === priorityFilter;
      return matchesSearch && matchesStatus && matchesPriority;
    });
  }, [crs, search, statusFilter, priorityFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paged = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <div>
      {ConfirmDialog}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Change Requests</h1>
        <Button onClick={() => navigate('/change-requests/new')}>
          <Plus className="size-4" /> New Change Request
        </Button>
      </div>

      {crs.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          <StatCard label="Total" value={crs.length} active={statusFilter === 'all'} onClick={() => setStatusFilter('all')} />
          {statusOpts
            .filter((o) => o.isActive && (statusCounts.get(o.value) ?? 0) > 0)
            .map((o) => (
              <StatCard
                key={o.id}
                label={o.label}
                value={statusCounts.get(o.value) ?? 0}
                active={statusFilter === o.value}
                onClick={() => setStatusFilter(statusFilter === o.value ? 'all' : o.value)}
              />
            ))}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter by number, title, customer..." className="pl-8" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {statusOpts.filter((o) => o.isActive).map((o) => <SelectItem key={o.id} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Priorities</SelectItem>
            {priorityOpts.filter((o) => o.isActive).map((o) => <SelectItem key={o.id} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">
          {filtered.length} change request{filtered.length === 1 ? '' : 's'}
        </span>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : (
        <div className="border-t">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>CR Date</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground">No change requests match your filters.</TableCell>
                </TableRow>
              )}
              {paged.map((c) => {
                // While a CR is awaiting/rejected by the customer, that's the one
                // status that matters — it replaces the workflow status entirely.
                const appr = c.approvalStatus === 'PENDING' || c.approvalStatus === 'REJECTED'
                  ? crApprovalMeta(c.approvalStatus) : null;
                return (
                <TableRow key={c.id} className="cursor-pointer" onClick={() => navigate(`/change-requests/${c.id}`)}>
                  <TableCell className="text-xs text-muted-foreground">{c.crNumber}</TableCell>
                  <TableCell className="font-medium">{c.title}</TableCell>
                  <TableCell>{c.customer || <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell>{c.projectName || <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell>
                    {c.priority ? <Badge variant={crPriorityVariant(c.priority)}>{c.priority}</Badge> : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>
                    {appr ? (
                      <span className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${appr.cls}`}>
                        {appr.label}
                      </span>
                    ) : (
                      <Badge variant={crStatusVariant(c.status)}>{c.status}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{fmtDate(c.crDate)}</TableCell>
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={async () => { if (await confirm({ title: `Delete ${c.crNumber}?`, description: 'This permanently removes the change request.', destructive: true, confirmText: 'Delete' })) deleteMutation.mutate(c.id); }}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
                );
              })}
            </TableBody>
          </Table>

          <div className="flex items-center justify-between border-t px-4 py-3">
            <span className="text-sm text-muted-foreground">Page {currentPage} of {totalPages}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={currentPage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                <ChevronLeft className="size-4" /> Prev
              </Button>
              <Button size="sm" variant="outline" disabled={currentPage >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                Next <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
