import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Search, ArrowUp, ArrowDown, ArrowUpDown, ChevronLeft, ChevronRight, Trash2, BarChart3 } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../lib/api';
import { Button } from '@/components/ui/button';
import { DateField } from '@/components/ui/date-field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useConfirm } from '@/hooks/useConfirm';
import {
  PROJECT_STATUSES, PRIORITIES, labelOf, projectStatusVariant, priorityVariant,
  type ProjectSummary, type UserOption, type CustomerCompanyOption,
} from './projectMeta';

const NONE = '__none__';

const createSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  key: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(PROJECT_STATUSES),
  priority: z.string().optional(),
  managerUserId: z.string().optional(),
  customerCompanyId: z.string().optional(),
  budget: z.string().optional(),
  currency: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});
type CreateValues = z.infer<typeof createSchema>;

type StatusFilter = 'all' | (typeof PROJECT_STATUSES)[number];
type SortField = 'name' | 'status' | 'progress';
type SortDir = 'asc' | 'desc';
const PAGE_SIZE = 10;

function SortableHead({
  label, field, sortField, sortDir, onSort, className,
}: {
  label: string; field: SortField; sortField: SortField; sortDir: SortDir;
  onSort: (f: SortField) => void; className?: string;
}) {
  const active = sortField === field;
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onSort(field)}
        className="flex items-center gap-1 text-xs font-medium text-muted-foreground uppercase hover:text-foreground"
      >
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
  const { confirm, ConfirmDialog } = useConfirm();
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [page, setPage] = useState(1);

  const form = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      name: '', key: '', description: '', status: 'OPEN',
      priority: '', managerUserId: '', customerCompanyId: '', budget: '', currency: '', startDate: '', endDate: '',
    },
  });

  const { data: projects = [], isLoading } = useQuery<ProjectSummary[]>({
    queryKey: ['projects', 'all'],
    queryFn: async () => (await api.get('/api/projects')).data,
  });
  const { data: users = [] } = useQuery<UserOption[]>({
    queryKey: ['users'],
    queryFn: async () => (await api.get('/api/users')).data,
  });
  const { data: companies = [] } = useQuery<CustomerCompanyOption[]>({
    queryKey: ['customer-companies'],
    queryFn: async () => (await api.get('/api/customer-companies')).data,
  });

  useEffect(() => { setPage(1); }, [search, statusFilter]);

  const createMutation = useMutation({
    mutationFn: (values: CreateValues) => api.post('/api/projects', {
      name: values.name,
      key: values.key || undefined,
      description: values.description || undefined,
      status: values.status,
      priority: values.priority || undefined,
      managerUserId: values.managerUserId || undefined,
      customerCompanyId: values.customerCompanyId || undefined,
      budget: values.budget ? Number(values.budget) : undefined,
      currency: values.currency || undefined,
      startDate: values.startDate || undefined,
      endDate: values.endDate || undefined,
    }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      setCreateOpen(false);
      form.reset();
      toast.success('Project created');
      navigate(`/projects/${res.data.id}`);
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error creating project'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/projects/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['projects'] }); toast.success('Project deleted'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error deleting project'),
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
      return matchesSearch && matchesStatus;
    });
  }, [projects, search, statusFilter]);

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
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" /> New Project
          </Button>
        </div>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="flex max-h-[88vh] flex-col sm:max-w-lg">
          <DialogHeader><DialogTitle>Create Project</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => createMutation.mutate(v))} className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="key" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Key</FormLabel>
                    <FormControl><Input placeholder="e.g. WEB" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="status" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger className="w-full"><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        {PROJECT_STATUSES.map((s) => <SelectItem key={s} value={s}>{labelOf(s)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
              </div>
              <FormField control={form.control} name="description" render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl><Textarea rows={3} {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="priority" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Priority</FormLabel>
                    <Select value={field.value || NONE} onValueChange={(v) => field.onChange(v === NONE ? '' : v)}>
                      <FormControl><SelectTrigger className="w-full"><SelectValue placeholder="None" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value={NONE}>None</SelectItem>
                        {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{labelOf(p)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
                <FormField control={form.control} name="managerUserId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Manager</FormLabel>
                    <Select value={field.value || NONE} onValueChange={(v) => field.onChange(v === NONE ? '' : v)}>
                      <FormControl><SelectTrigger className="w-full"><SelectValue placeholder="Unassigned" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value={NONE}>Unassigned</SelectItem>
                        {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.username}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
              </div>
              <FormField control={form.control} name="customerCompanyId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Customer Company</FormLabel>
                  <Select value={field.value || NONE} onValueChange={(v) => field.onChange(v === NONE ? '' : v)}>
                    <FormControl><SelectTrigger className="w-full"><SelectValue placeholder="None" /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value={NONE}>None</SelectItem>
                      {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />
              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="budget" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Budget</FormLabel>
                    <FormControl><Input type="number" min="0" placeholder="0" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="currency" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Currency</FormLabel>
                    <FormControl><Input placeholder="USD" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="startDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Start Date</FormLabel>
                    <FormControl><DateField value={field.value} onChange={field.onChange} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="endDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>End Date</FormLabel>
                    <FormControl><DateField value={field.value} onChange={field.onChange} min={form.watch('startDate') || undefined} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              </div>
              <DialogFooter className="pt-3">
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? 'Creating...' : 'Create'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

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
        <span className="text-sm text-muted-foreground">
          {sorted.length} project{sorted.length === 1 ? '' : 's'}
        </span>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : (
        <div className="overflow-x-auto border-t">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <SortableHead label="Name" field="name" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <SortableHead label="Status" field="status" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <TableHead>Priority</TableHead>
                <TableHead>Manager</TableHead>
                <SortableHead label="Progress" field="progress" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <TableHead className="text-right">Actions</TableHead>
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
                  <TableCell className="text-xs text-muted-foreground">{p.projectNumber}</TableCell>
                  <TableCell className="font-medium">
                    {p.name}{p.key ? <span className="ml-1 text-xs text-muted-foreground">· {p.key}</span> : null}
                  </TableCell>
                  <TableCell><Badge variant={projectStatusVariant(p.status)}>{labelOf(p.status)}</Badge></TableCell>
                  <TableCell>
                    {p.priority ? <Badge variant={priorityVariant(p.priority)}>{labelOf(p.priority)}</Badge> : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>{p.managerName || <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                        <div className="h-full bg-primary" style={{ width: `${p.progress}%` }} />
                      </div>
                      <span className="text-xs text-muted-foreground">{p.progress}%</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={async () => { if (await confirm({ title: `Delete project "${p.name}"?`, description: 'This permanently removes the project and its data.', destructive: true, confirmText: 'Delete' })) deleteMutation.mutate(p.id); }}
                    >
                      <Trash2 className="size-4" />
                    </Button>
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
