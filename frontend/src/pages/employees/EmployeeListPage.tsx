import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Search, IdCard, UserRound, Building, BriefcaseBusiness, Phone, UserCog, Package,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import api from '../../lib/api';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { personName } from './employeeMeta';
import type { Employee, AssetAllocation } from './employeeMeta';

const PAGE_SIZE = 10;

/**
 * Every internal staff member, as an employee. There is no create button — a
 * person becomes an employee by being a user, so they are added on the Users
 * screen and their employee record is filled in here.
 */
export default function EmployeeListPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);

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

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return staff;
    return staff.filter((u) =>
      [u.employeeId, u.name, u.username, u.department, u.designation, u.email]
        .some((v) => v?.toLowerCase().includes(term)),
    );
  }, [staff, q]);

  // A narrowed search can leave the viewer stranded past the last page.
  useEffect(() => { setPage(1); }, [q]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paged = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const Dash = () => <span className="text-muted-foreground">—</span>;

  return (
    <div className="w-full">
      <div className="mb-4">
        <h1 className="text-2xl font-bold tracking-tight">Employee Master</h1>
        <p className="text-sm text-muted-foreground">
          Your staff and the assets allocated to them. New people are added on the Users screen.
        </p>
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
                <TableHead className="border-r"><HeadLabel icon={IdCard}>Employee ID</HeadLabel></TableHead>
                <TableHead className="w-full border-r"><HeadLabel icon={UserRound}>Employee name</HeadLabel></TableHead>
                <TableHead className="border-r"><HeadLabel icon={Building}>Department</HeadLabel></TableHead>
                <TableHead className="border-r"><HeadLabel icon={BriefcaseBusiness}>Designation</HeadLabel></TableHead>
                <TableHead className="border-r"><HeadLabel icon={Phone}>Phone</HeadLabel></TableHead>
                <TableHead className="border-r"><HeadLabel icon={UserCog}>Manager</HeadLabel></TableHead>
                <TableHead><HeadLabel icon={Package}>Assets</HeadLabel></TableHead>
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
    </div>
  );
}

function HeadLabel({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
      <Icon className="size-3.5 shrink-0" />
      {children}
    </span>
  );
}
