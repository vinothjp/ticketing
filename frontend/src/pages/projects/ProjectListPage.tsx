import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, ArrowUp, ArrowDown, ArrowUpDown, ChevronLeft, ChevronRight, BarChart3,
  Hash, FolderKanban, CircleDot, Flag, AtSign, ToggleRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import api from '../../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

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

import { useAuth } from '@/context/AuthContext';
import { useConfirm } from '@/hooks/useConfirm';
import {
  PROJECT_STATUSES, labelOf, projectStatusVariant, priorityVariant,
  type ProjectSummary,
} from './projectMeta';

type StatusFilter = 'all' | (typeof PROJECT_STATUSES)[number];
type ActiveFilter = 'all' | 'active' | 'inactive';
type SortField = 'name' | 'status' | 'progress';
type SortDir = 'asc' | 'desc';
const PAGE_SIZE = 10;

/** Green for an active project, grey for a deactivated one — the pill and the admin's dropdown share it. */
const activePill = (active: boolean) => (active
  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
  : 'bg-muted text-muted-foreground');

function SortableHead({
  label, field, sortField, sortDir, onSort, className, icon: Icon,
}: {
  label: string; field: SortField; sortField: SortField; sortDir: SortDir;
  onSort: (f: SortField) => void; className?: string; icon: LucideIcon;
}) {
  const active = sortField === field;
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onSort(field)}
        className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
      >
        <Icon className="size-3.5 shrink-0" />
        {label}
        {active ? (
          sortDir === 'asc' ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />
        ) : (
          <ArrowUpDown className="size-3.5 opacity-40" />
        )}
      </button>
    </TableHead>
  );
}

export default function ProjectListPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { confirm, ConfirmDialog } = useConfirm();
  const isAdmin = !!user?.roles.includes('Admin');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>('all');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [page, setPage] = useState(1);

  const { data: projects = [], isLoading } = useQuery<ProjectSummary[]>({
    queryKey: ['projects', 'all'],
    queryFn: async () => (await api.get('/api/projects')).data,
  });
  useEffect(() => { setPage(1); }, [search, statusFilter, activeFilter]);

  // Projects are never deleted (like tickets) — an Admin deactivates one instead.
  const toggleActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => api.patch(`/api/projects/${id}`, { isActive }),
    onSuccess: (_res, v) => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      toast.success(v.isActive ? 'Project activated' : 'Project deactivated');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error updating project'),
  });

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortField(field); setSortDir('asc'); }
  };

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return projects.filter((p) => {
      const matchesSearch = !term
        || p.name.toLowerCase().includes(term)
        || p.projectNumber.toLowerCase().includes(term)
        || (p.key ?? '').toLowerCase().includes(term);
      const matchesStatus = statusFilter === 'all' || p.status === statusFilter;
      const matchesActive = activeFilter === 'all' || (activeFilter === 'active' ? p.isActive : !p.isActive);
      return matchesSearch && matchesStatus && matchesActive;
    });
  }, [projects, search, statusFilter, activeFilter]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortField === 'status') cmp = a.status.localeCompare(b.status);
      else cmp = a.progress - b.progress;
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paged = sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <div>
      {ConfirmDialog}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Projects</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate('/projects/analytics')}>
            <BarChart3 className="size-4" /> Analytics
          </Button>
          <Button onClick={() => navigate('/projects/new')}>
            <Plus className="size-4" /> New Project
          </Button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by name or number..."
            className="pl-8"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {PROJECT_STATUSES.map((s) => <SelectItem key={s} value={s}>{labelOf(s)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={activeFilter} onValueChange={(v) => setActiveFilter(v as ActiveFilter)}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Active & deactivated" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Active & deactivated</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Deactivated</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">
          {sorted.length} project{sorted.length === 1 ? '' : 's'}
        </span>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="border-r"><HeadLabel icon={Hash}>Number</HeadLabel></TableHead>
                <SortableHead className="w-full border-r" icon={FolderKanban} label="Name" field="name" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <SortableHead className="border-r" icon={CircleDot} label="Status" field="status" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <TableHead className="border-r"><HeadLabel icon={Flag}>Priority</HeadLabel></TableHead>
                <TableHead className="border-r"><HeadLabel icon={AtSign}>Manager</HeadLabel></TableHead>
                <SortableHead className="border-r" icon={BarChart3} label="Progress" field="progress" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <TableHead><HeadLabel icon={ToggleRight}>Active</HeadLabel></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    No projects match your filters.
                  </TableCell>
                </TableRow>
              )}
              {paged.map((p) => (
                <TableRow key={p.id} className="cursor-pointer" onClick={() => navigate(`/projects/${p.id}`)}>
                  <TableCell className="border-r">
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{p.projectNumber}</code>
                  </TableCell>
                  <TableCell className="w-full border-r font-medium text-foreground">
                    <span className="block max-w-[20rem] truncate" title={p.name}>
                      {p.name}{p.key ? <span className="ml-1 text-xs font-normal text-muted-foreground">· {p.key}</span> : null}
                    </span>
                  </TableCell>
                  <TableCell className="border-r"><Badge variant={projectStatusVariant(p.status)}>{labelOf(p.status)}</Badge></TableCell>
                  <TableCell className="border-r">
                    {p.priority ? <Badge variant={priorityVariant(p.priority)}>{labelOf(p.priority)}</Badge> : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="border-r">
                    {p.managerName ? (
                      <span className="flex items-center gap-2">
                        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
                          {p.managerName.slice(0, 2).toUpperCase()}
                        </span>
                        <span className="block max-w-[9rem] truncate text-foreground" title={p.managerName}>{p.managerName}</span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="border-r">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                        <div className="h-full bg-primary" style={{ width: `${p.progress}%` }} />
                      </div>
                      <span className="text-xs tabular-nums text-muted-foreground">{p.progress}%</span>
                    </div>
                  </TableCell>
                  <TableCell onClick={isAdmin ? (e) => e.stopPropagation() : undefined}>
                    {isAdmin ? (
                      <Select
                        value={p.isActive ? 'active' : 'inactive'}
                        onValueChange={async (v) => {
                          const next = v === 'active';
                          if (!v || next === p.isActive) return; // ignore a re-pick / Radix's empty reset
                          if (!next && !(await confirm({
                            title: `Deactivate project "${p.name}"?`,
                            description: 'The project and all its data stay; it is only marked as deactivated. You can activate it again at any time.',
                            confirmText: 'Deactivate',
                          }))) return;
                          toggleActive.mutate({ id: p.id, isActive: next });
                        }}
                        disabled={toggleActive.isPending}
                      >
                        <SelectTrigger
                          size="sm"
                          className={`h-auto w-auto gap-1 rounded border-0 px-1.5 py-0.5 text-xs font-bold uppercase shadow-none data-[size=sm]:h-auto ${activePill(p.isActive)}`}
                        >
                          <SelectValue placeholder="Active" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="active">Active</SelectItem>
                          <SelectItem value="inactive">Deactivated</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-bold uppercase ${activePill(p.isActive)}`}>
                        {p.isActive ? 'Active' : 'Deactivated'}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
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
