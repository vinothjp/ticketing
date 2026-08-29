import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, UserRound } from 'lucide-react';
import api from '../../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import PicklistSelect from '@/components/PicklistSelect';
import AssetAllocationGrid from './AssetAllocationGrid';
import { personName, isManager } from './employeeMeta';
import type { Employee } from './employeeMeta';

/** No manager. Radix cannot hold an empty SelectItem value, so it needs a sentinel. */
const NO_MANAGER = '__none__';

/**
 * One employee: the header of employee facts, and the assets allocated to them.
 *
 * The employee *is* the staff user — these fields live on the `User` row — so
 * this screen saves through `PUT /api/users/:id` rather than a table of its
 * own. Username, email and roles stay on the Users screen; this one owns the
 * employee record.
 */
export default function EmployeeDetailPage() {
  const { userId = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [employeeId, setEmployeeId] = useState('');
  const [name, setName] = useState('');
  const [department, setDepartment] = useState('');
  const [designation, setDesignation] = useState('');
  const [phone, setPhone] = useState('');
  const [managerId, setManagerId] = useState(NO_MANAGER);

  const { data: employee, isLoading } = useQuery<Employee>({
    queryKey: ['employee', userId],
    queryFn: async () => (await api.get(`/api/users/${userId}`)).data,
    enabled: !!userId,
  });

  // A manager is a staff user carrying the Admin role — the same rule the server
  // enforces on save, so the dropdown never offers something it would reject.
  const { data: staff = [] } = useQuery<Employee[]>({
    queryKey: ['employees'],
    queryFn: async () => (await api.get('/api/users')).data,
  });
  const managers = staff.filter((u) => u.id !== userId && isManager(u));

  // Keyed on the saved *content*, not the record object: TanStack refetches on
  // window focus and hands back a new object each time, which would otherwise
  // re-hydrate the form and discard whatever the admin had typed.
  const saved = JSON.stringify({
    employeeId: employee?.employeeId ?? '',
    name: employee?.name ?? '',
    department: employee?.department ?? '',
    designation: employee?.designation ?? '',
    phone: employee?.phone ?? '',
    managerId: employee?.managerId ?? '',
  });
  useEffect(() => {
    if (!employee) return;
    setEmployeeId(employee.employeeId ?? '');
    setName(employee.name ?? '');
    setDepartment(employee.department ?? '');
    setDesignation(employee.designation ?? '');
    setPhone(employee.phone ?? '');
    setManagerId(employee.managerId ?? NO_MANAGER);
  }, [saved]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: () =>
      // null, never undefined, for a box the admin emptied — undefined would be
      // dropped from the payload and the clear silently lost.
      api.put(`/api/users/${userId}`, {
        employeeId: employeeId.trim() || null,
        name: name.trim() || null,
        department: department.trim() || null,
        designation: designation.trim() || null,
        phone: phone.trim() || null,
        managerId: managerId === NO_MANAGER ? null : managerId,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employee', userId] });
      qc.invalidateQueries({ queryKey: ['employees'] });
      qc.invalidateQueries({ queryKey: ['users'] });
      toast.success('Employee saved');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error saving employee'),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!employee) return <p className="text-sm text-muted-foreground">Employee not found.</p>;

  const Req = () => <span className="text-destructive">*</span>;

  return (
    <div className="w-full">
      <Button variant="ghost" size="sm" className="mb-2 -ml-2" onClick={() => navigate('/admin/employees')}>
        <ArrowLeft className="size-4" /> All employees
      </Button>

      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <UserRound className="size-6 shrink-0 text-muted-foreground" />
            <span className="truncate" title={personName(employee)}>{personName(employee)}</span>
          </h1>
          <p className="text-sm text-muted-foreground">
            {[employee.employeeId, employee.designation, employee.email].filter(Boolean).join(' · ')}
          </p>
        </div>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save employee'}
        </Button>
      </div>

      <form
        className="mb-6 space-y-4 rounded-lg border p-4"
        onSubmit={(e) => { e.preventDefault(); save.mutate(); }}
      >
        {/* Row one: who they are. Row two: where they sit. Weighted so the name
            takes the slack rather than the grid spreading a gap through every
            field. */}
        <div className="grid gap-4 sm:grid-cols-[8fr_12fr_8fr]">
          <div className="space-y-1.5">
            <Label htmlFor="employeeId">Employee ID</Label>
            <Input
              id="employeeId"
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              placeholder="EMP-0142"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="name">Employee name <Req /></Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder={employee.username} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="manager">Manager</Label>
            {/* A real pick is never empty — ignore the '' Radix emits while the
                staff list is still loading, or it wipes the hydrated value. */}
            <Select value={managerId} onValueChange={(v) => { if (v) setManagerId(v); }}>
              <SelectTrigger id="manager" className="w-full [&>span]:min-w-0 [&>span]:truncate">
                <SelectValue placeholder="Select a manager..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_MANAGER}>No manager</SelectItem>
                {managers.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{personName(m)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {/* Department and Designation are option lists — managed on
              /admin/options so the whole company shares one vocabulary. The
              identity fields either side of them stay free text. */}
          <div className="space-y-1.5">
            <Label htmlFor="department">Department</Label>
            <PicklistSelect
              id="department" listKey="employeeDepartment"
              value={department} onChange={setDepartment}
              placeholder="Select a department..."
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="designation">Designation</Label>
            <PicklistSelect
              id="designation" listKey="designation"
              value={designation} onChange={setDesignation}
              placeholder="Select a designation..."
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
        </div>

        {managers.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No managers to pick from yet — a manager is a staff user carrying the Admin role, created
            on the Users screen.
          </p>
        )}
      </form>

      <AssetAllocationGrid employeeUserId={userId} />
    </div>
  );
}
