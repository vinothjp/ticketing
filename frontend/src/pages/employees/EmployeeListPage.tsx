import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import {
  Search, IdCard, UserRound, Building, BriefcaseBusiness, Phone, UserCog, Package,
  ChevronLeft, ChevronRight, Plus, ArrowUp, ArrowDown, ArrowUpDown,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import api from '../../lib/api';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import PicklistSelect from '@/components/PicklistSelect';
import { personName, isManager } from './employeeMeta';
import type { Employee, AssetAllocation } from './employeeMeta';

const PAGE_SIZE = 10;

/** No manager. Radix cannot hold an empty SelectItem value, so it needs a sentinel. */
const NO_MANAGER = '__none__';

type SortField = 'employeeId' | 'name' | 'department' | 'designation' | 'phone' | 'manager' | 'assets';
type SortDir = 'asc' | 'desc';

/**
 * An employee *is* a staff user, so creating one is a `POST /api/users` that
 * seeds the employee columns in the same call — the login half (username, email,
 * password) is required, the employee half optional and completable later on the
 * detail screen. Roles stay on the Users screen, as in its own create dialog.
 */
const createSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  name: z.string().optional(),
  email: z.string().email('Enter a valid email'),
  password: z.string().min(8, 'Min 8 characters'),
  employeeId: z.string().optional(),
  department: z.string().optional(),
  designation: z.string().optional(),
  phone: z.string().optional(),
  managerId: z.string(),
});
type CreateValues = z.infer<typeof createSchema>;

const EMPTY_CREATE: CreateValues = {
  username: '', name: '', email: '', password: '',
  employeeId: '', department: '', designation: '', phone: '', managerId: NO_MANAGER,
};

/**
 * Every internal staff member, as an employee. New employees are created here —
 * the same `User` row the Users screen manages, seeded with its employee fields.
 */
export default function EmployeeListPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [createOpen, setCreateOpen] = useState(false);

  const { data: staff = [], isLoading } = useQuery<Employee[]>({
    queryKey: ['employees'],
    queryFn: async () => (await api.get('/api/users')).data,
  });

  // One read of every allocation, counted per employee — cheaper than a query
  // per row, and the Assets column is the reason to open a row at all.
  const { data: allocations = [] } = useQuery<AssetAllocation[]>({
    queryKey: ['asset-allocations'],
    queryFn: async () => (await api.get('/api/asset-allocations')).data,
  });
  const heldByUser = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of allocations) {
      if (a.status === 'RETURNED') continue;
      counts.set(a.employeeUserId, (counts.get(a.employeeUserId) ?? 0) + 1);
    }
    return counts;
  }, [allocations]);

  const managers = useMemo(() => staff.filter(isManager), [staff]);

  const createForm = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: EMPTY_CREATE,
  });

  const createEmployee = useMutation({
    mutationFn: (v: CreateValues) =>
      api.post('/api/users', {
        username: v.username.trim(),
        name: v.name?.trim() || undefined,
        email: v.email.trim(),
        password: v.password,
        employeeId: v.employeeId?.trim() || undefined,
        department: v.department?.trim() || undefined,
        designation: v.designation?.trim() || undefined,
        phone: v.phone?.trim() || undefined,
        managerId: v.managerId === NO_MANAGER ? undefined : v.managerId,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employees'] });
      qc.invalidateQueries({ queryKey: ['users'] });
      setCreateOpen(false);
      createForm.reset(EMPTY_CREATE);
      toast.success('Employee created');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error creating employee'),
  });

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return staff;
    return staff.filter((u) =>
      [u.employeeId, u.name, u.username, u.department, u.designation, u.email]
        .some((v) => v?.toLowerCase().includes(term)),
    );
  }, [staff, q]);

  const rows = useMemo(() => {
    // A blank cell sorts to the bottom in *both* directions — flipping the
    // direction is meant to reorder the values, not bury them under the dashes.
    const text = (u: Employee, f: SortField) =>
      f === 'employeeId' ? u.employeeId ?? ''
      : f === 'name' ? personName(u)
      : f === 'department' ? u.department ?? ''
      : f === 'designation' ? u.designation ?? ''
      : f === 'phone' ? u.phone ?? ''
      : u.manager ? personName(u.manager) : '';

    return [...filtered].sort((a, b) => {
      if (sortField === 'assets') {
        const cmp = (heldByUser.get(a.id) ?? 0) - (heldByUser.get(b.id) ?? 0);
        return sortDir === 'asc' ? cmp : -cmp;
      }
      const va = text(a, sortField);
      const vb = text(b, sortField);
      if (!va && !vb) return 0;
      if (!va) return 1;
      if (!vb) return -1;
      const cmp = va.localeCompare(vb, undefined, { numeric: true, sensitivity: 'base' });
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sortField, sortDir, heldByUser]);

  // A narrowed search — or a re-sort — can leave the viewer stranded past the
  // last page, or looking at a page of rows they did not pick.
  useEffect(() => { setPage(1); }, [q, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paged = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortField(field); setSortDir('asc'); }
  };
  const headProps = { sortField, sortDir, onSort: handleSort };

  const Dash = () => <span className="text-muted-foreground">—</span>;

  return (
    <div className="w-full">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">Employee Master</h1>
          <p className="text-sm text-muted-foreground">
            Your staff and the assets allocated to them. An employee is a staff login — roles are set on the Users screen.
          </p>
        </div>
        <Button onClick={() => { createForm.reset(EMPTY_CREATE); setCreateOpen(true); }}>
          <Plus className="size-4" /> New employee
        </Button>
      </div>

      <div className="relative mb-5 max-w-sm">
        <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search employees…"
          className="pl-8"
        />
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-12 text-center">
          <UserRound className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {q ? 'No employees match your search.' : 'No staff users yet.'}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <SortableHead icon={IdCard} label="Employee ID" field="employeeId" {...headProps} />
                <SortableHead icon={UserRound} label="Employee name" field="name" className="w-full" {...headProps} />
                <SortableHead icon={Building} label="Department" field="department" {...headProps} />
                <SortableHead icon={BriefcaseBusiness} label="Designation" field="designation" {...headProps} />
                <SortableHead icon={Phone} label="Phone" field="phone" {...headProps} />
                <SortableHead icon={UserCog} label="Manager" field="manager" {...headProps} />
                <SortableHead icon={Package} label="Assets" field="assets" last {...headProps} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.map((u) => {
                const held = heldByUser.get(u.id) ?? 0;
                return (
                  <TableRow
                    key={u.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/admin/employees/${u.id}`)}
                  >
                    <TableCell className="w-px border-r">
                      {u.employeeId
                        ? <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{u.employeeId}</code>
                        : <Dash />}
                    </TableCell>
                    <TableCell className="w-full border-r font-medium text-foreground">
                      <span className="flex items-center gap-2">
                        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
                          {personName(u).slice(0, 2).toUpperCase()}
                        </span>
                        <span className="block max-w-[16rem] truncate" title={personName(u)}>
                          {personName(u)}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell className="border-r">
                      {u.department
                        ? <span className="block max-w-[10rem] truncate" title={u.department}>{u.department}</span>
                        : <Dash />}
                    </TableCell>
                    <TableCell className="border-r">
                      {u.designation
                        ? <span className="block max-w-[10rem] truncate" title={u.designation}>{u.designation}</span>
                        : <Dash />}
                    </TableCell>
                    <TableCell className="border-r whitespace-nowrap">{u.phone || <Dash />}</TableCell>
                    <TableCell className="border-r">
                      {u.manager
                        ? <span className="block max-w-[10rem] truncate" title={personName(u.manager)}>{personName(u.manager)}</span>
                        : <Dash />}
                    </TableCell>
                    <TableCell className={`tabular-nums ${held ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
                      {held || '—'}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          <div className="flex items-center justify-between border-t px-4 py-3">
            <span className="text-sm text-muted-foreground">
              Page {currentPage} of {totalPages} · {rows.length} {rows.length === 1 ? 'employee' : 'employees'}
            </span>
            <div className="flex gap-2">
              <Button
                size="sm" variant="outline" disabled={currentPage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="size-4" /> Prev
              </Button>
              <Button
                size="sm" variant="outline" disabled={currentPage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>New employee</DialogTitle>
          </DialogHeader>
          <Form {...createForm}>
            <form
              className="space-y-4"
              onSubmit={createForm.handleSubmit((v) => createEmployee.mutate(v))}
            >
              <div className="grid gap-4 sm:grid-cols-3">
                <FormField
                  control={createForm.control}
                  name="employeeId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Employee ID</FormLabel>
                      <FormControl><Input placeholder="EMP-0142" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={createForm.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Employee name</FormLabel>
                      <FormControl><Input placeholder="e.g. John Rivera" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={createForm.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Phone</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                {/* Department and Designation are option lists — managed on
                    /admin/options so the whole company shares one vocabulary. */}
                <FormField
                  control={createForm.control}
                  name="department"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Department</FormLabel>
                      <PicklistSelect
                        listKey="employeeDepartment"
                        value={field.value ?? ''}
                        onChange={field.onChange}
                        placeholder="Select a department..."
                      />
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={createForm.control}
                  name="designation"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Designation</FormLabel>
                      <PicklistSelect
                        listKey="designation"
                        value={field.value ?? ''}
                        onChange={field.onChange}
                        placeholder="Select a designation..."
                      />
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={createForm.control}
                  name="managerId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Manager</FormLabel>
                      {/* A real pick is never empty — ignore the '' Radix emits
                          while the staff list is still loading. */}
                      <Select value={field.value} onValueChange={(v) => { if (v) field.onChange(v); }}>
                        <SelectTrigger className="w-full [&>span]:min-w-0 [&>span]:truncate">
                          <SelectValue placeholder="Select a manager..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_MANAGER}>No manager</SelectItem>
                          {managers.map((m) => (
                            <SelectItem key={m.id} value={m.id}>{personName(m)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* The login half. An employee has to be a staff user before they
                  can be an employee, so these three are the required fields. */}
              <div className="rounded-lg border p-4">
                <Label className="text-xs font-semibold uppercase text-muted-foreground">Login</Label>
                <div className="mt-3 grid gap-4 sm:grid-cols-3">
                  <FormField
                    control={createForm.control}
                    name="username"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Username</FormLabel>
                        <FormControl><Input {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={createForm.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl><Input type="email" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={createForm.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Password</FormLabel>
                        <FormControl><Input type="password" placeholder="Min 8 characters" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createEmployee.isPending}>
                  {createEmployee.isPending ? 'Creating…' : 'Create employee'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * A sortable column heading, in the same mould as the one on `UsersPage`: the
 * column's own icon leads, the sort indicator trails, so it reads as the same
 * kind of heading the other list screens use while still saying which way the
 * table is ordered. Every column here is sortable, so the plain `HeadLabel` this
 * table used to render has no caller left.
 */
function SortableHead({
  label, field, sortField, sortDir, onSort, icon: Icon, className = '', last = false,
}: {
  label: string; field: SortField; sortField: SortField; sortDir: SortDir;
  onSort: (field: SortField) => void; icon: LucideIcon; className?: string; last?: boolean;
}) {
  const active = sortField === field;
  return (
    <TableHead className={`${last ? '' : 'border-r'} ${className}`}>
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
