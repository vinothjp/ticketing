import { useMemo, useState, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuCheckboxItem, DropdownMenuRadioGroup, DropdownMenuRadioItem,
  DropdownMenuLabel, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { getPriorityMeta, isTerminalStatus, type TicketSummary } from './ticketHelpers';

interface TemplateSummary { id: string; name: string; }
interface CompanyOption { id: string; name: string; }
interface UserOption { id: string; username: string; }
interface PicklistOpt { value: string; label: string; isActive?: boolean }
interface MyTask {
  id: string;
  title: string;
  status: string;
  dueDate?: string | null;
  assigneeName?: string | null;
  ticket: { id: string; ticketNumber: string; subject: string; ticketStatus: string; priority?: string | null };
}

type ViewKey = 'all' | 'mine' | 'overdue' | 'unassigned' | 'tasks';
type SortKey = 'newest' | 'oldest' | 'priority' | 'due';

const PRIORITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export default function TicketListPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isAdmin = !!user?.roles.includes('Admin');
  const [searchParams, setSearchParams] = useSearchParams();

  // Admins can reassign technicians inline from the list.
  const { data: assignableUsers = [] } = useQuery<UserOption[]>({
    queryKey: ['users'],
    queryFn: async () => (await api.get('/api/users')).data,
    enabled: isAdmin,
  });
  const assignMutation = useMutation({
    mutationFn: ({ id, userIds }: { id: string; userIds: string[] }) =>
      api.put(`/api/tickets/${id}/technicians`, { userIds }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tickets'] }),
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error assigning'),
  });

  // Status / priority options for inline editing (admins only).
  const { data: statusOpts = [] } = useQuery<PicklistOpt[]>({
    queryKey: ['picklist-options', 'ticketStatus'],
    queryFn: async () => (await api.get('/api/picklist-options', { params: { listKey: 'ticketStatus' } })).data,
    enabled: isAdmin,
  });
  const { data: priorityOpts = [] } = useQuery<PicklistOpt[]>({
    queryKey: ['picklist-options', 'priority'],
    queryFn: async () => (await api.get('/api/picklist-options', { params: { listKey: 'priority' } })).data,
    enabled: isAdmin,
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => api.put(`/api/tickets/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tickets'] }),
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error updating ticket'),
  });
  const typeFilter = searchParams.get('type') ?? '';

  const [view, setView] = useState<ViewKey>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [companyFilter, setCompanyFilter] = useState<string>('all');
  const [sort, setSort] = useState<SortKey>('newest');

  const { data: tickets = [], isLoading } = useQuery<TicketSummary[]>({
    queryKey: ['tickets'],
    queryFn: async () => (await api.get('/api/tickets')).data,
  });
  const { data: templates = [] } = useQuery<TemplateSummary[]>({
    queryKey: ['templates'],
    queryFn: async () => (await api.get('/api/templates')).data,
  });
  // Open tasks assigned to the current agent across all tickets (incl. other agents' tickets).
  const { data: myTasks = [] } = useQuery<MyTask[]>({
    queryKey: ['my-tasks'],
    queryFn: async () => (await api.get('/api/my-tasks')).data,
  });
  // Customer companies for the "filter by customer" control (staff only).
  const isCustomer = !!user?.roles.includes('Customer') && !isAdmin;
  const { data: companies = [] } = useQuery<CompanyOption[]>({
    queryKey: ['customer-companies'],
    queryFn: async () => (await api.get('/api/customer-companies')).data,
    enabled: !isCustomer,
  });

  const categories = useMemo(
    () => Array.from(new Set(tickets.map((t) => t.ticketCategory).filter((c): c is string => !!c))),
    [tickets],
  );

  const byType = useMemo(
    () => (typeFilter ? tickets.filter((t) => t.template?.name === typeFilter) : tickets),
    [tickets, typeFilter],
  );

  const viewCounts = useMemo(() => ({
    all: byType.length,
    mine: byType.filter((t) => t.technicians.some((tt) => tt.user.id === user?.id)).length,
    overdue: byType.filter((t) => !isTerminalStatus(t.ticketStatus) && t.dueDate && new Date(t.dueDate) < new Date()).length,
    unassigned: byType.filter((t) => t.technicians.length === 0).length,
    tasks: myTasks.length,
  }), [byType, user?.id, myTasks.length]);

  const filtered = useMemo(() => {
    let list = byType;
    if (view === 'mine') list = list.filter((t) => t.technicians.some((tt) => tt.user.id === user?.id));
    if (view === 'overdue') list = list.filter((t) => !isTerminalStatus(t.ticketStatus) && t.dueDate && new Date(t.dueDate) < new Date());
    if (view === 'unassigned') list = list.filter((t) => t.technicians.length === 0);
    if (priorityFilter !== 'all') list = list.filter((t) => (t.priority ?? '').toLowerCase() === priorityFilter);
    if (categoryFilter !== 'all') list = list.filter((t) => t.ticketCategory === categoryFilter);
    if (companyFilter !== 'all') list = list.filter((t) => t.customerCompany?.id === companyFilter);
    return list;
  }, [byType, view, priorityFilter, categoryFilter, companyFilter, user?.id]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => {
      switch (sort) {
        case 'oldest':
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        case 'priority':
          return (PRIORITY_ORDER[(a.priority ?? '').toLowerCase()] ?? 99) - (PRIORITY_ORDER[(b.priority ?? '').toLowerCase()] ?? 99);
        case 'due':
          if (!a.dueDate) return 1;
          if (!b.dueDate) return -1;
          return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
        case 'newest':
        default:
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
    });
    return list;
  }, [filtered, sort]);

  const views: { key: ViewKey; label: string; count: number }[] = [
    { key: 'all', label: 'All tickets', count: viewCounts.all },
    { key: 'mine', label: 'Assigned tickets', count: viewCounts.mine },
    { key: 'tasks', label: 'Assigned tasks', count: viewCounts.tasks },
    { key: 'overdue', label: 'Overdue', count: viewCounts.overdue },
    { key: 'unassigned', label: 'Unassigned', count: viewCounts.unassigned },
  ];

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {view === 'tasks' ? 'Assigned tasks' : (typeFilter || 'All tickets')}
          </h1>
          <p className="text-sm text-muted-foreground">
            {view === 'tasks' ? `${myTasks.length} open task(s)` : `${sorted.length} of ${tickets.length}`}
          </p>
        </div>
        <Button asChild>
          <Link to="/tickets/new"><Plus className="size-4" /> New request</Link>
        </Button>
      </div>

      {/* Views (segmented) */}
      <div className="flex flex-wrap gap-1 border-b pb-3">
        {views.map((v) => (
          <button
            key={v.key}
            type="button"
            onClick={() => setView(v.key)}
            className={cn(
              'flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors hover:bg-accent',
              view === v.key ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground',
            )}
          >
            {v.label}
            <span className={cn('rounded-full px-1.5 text-xs', view === v.key ? 'bg-primary/15' : 'bg-muted text-muted-foreground')}>{v.count}</span>
          </button>
        ))}
      </div>

      {/* Filters + sort (tickets only) */}
      <div className={cn('mb-5 flex flex-wrap items-center gap-2 py-3', view === 'tasks' && 'hidden')}>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All priorities</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={typeFilter || 'all'} onValueChange={(v) => setSearchParams(v === 'all' ? {} : { type: v })}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All templates</SelectItem>
            {templates.map((t) => <SelectItem key={t.id} value={t.name}>{t.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {!isCustomer && companies.length > 0 && (
          <Select value={companyFilter} onValueChange={setCompanyFilter}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All customers</SelectItem>
              {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <div className="ml-auto">
          <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest first</SelectItem>
              <SelectItem value="oldest">Oldest first</SelectItem>
              <SelectItem value="priority">Priority</SelectItem>
              <SelectItem value="due">Due date</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {view === 'tasks' ? (
        <div className="divide-y border-y">
          {myTasks.length === 0 && <p className="p-6 text-center text-muted-foreground">No open tasks assigned to you.</p>}
          {myTasks.map((task) => {
            const priority = getPriorityMeta(task.ticket.priority);
            const due = task.dueDate
              ? new Date(task.dueDate).toLocaleString(undefined, { month: 'short', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
              : '—';
            return (
              <div
                key={task.id}
                onClick={() => navigate(`/tickets/${task.ticket.id}`)}
                className="flex cursor-pointer items-stretch gap-3 px-1 py-3 transition-colors hover:bg-accent/40"
              >
                <div className={`w-1 shrink-0 rounded-full ${priority.barClass}`} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-foreground">{task.title}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span className="text-primary hover:underline">
                      <span className="text-muted-foreground">#{task.ticket.ticketNumber}</span> {task.ticket.subject}
                    </span>
                    <span className="text-border">|</span>
                    <span>Due : <span className="text-foreground">{due}</span></span>
                    <span className="text-border">|</span>
                    <span>Status : <span className="text-foreground">{task.status}</span></span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : isLoading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : (
        <div className="divide-y border-y">
            {sorted.length === 0 && <p className="p-6 text-center text-muted-foreground">No tickets match this view.</p>}
            {sorted.map((t) => {
              const priority = getPriorityMeta(t.priority);
              const due = t.dueDate
                ? new Date(t.dueDate).toLocaleString(undefined, { month: 'short', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                : '—';
              const sep = <span className="text-border">|</span>;
              return (
                <div
                  key={t.id}
                  onClick={() => navigate(`/tickets/${t.id}`)}
                  className="flex cursor-pointer items-stretch gap-3 px-1 py-3 transition-colors hover:bg-accent/40"
                >
                  <div className={`w-1 shrink-0 rounded-full ${priority.barClass}`} />
                  <div className="min-w-0 flex-1">
                    {/* Title + hover preview */}
                    <div className="group/tt relative inline-block max-w-full align-top">
                      <span className="text-sm font-medium text-primary hover:underline">
                        <span className="text-muted-foreground">#{t.ticketNumber}</span> {t.subject}
                      </span>
                      <div className="pointer-events-none absolute top-full left-0 z-20 mt-1 hidden w-[26rem] max-w-[88vw] rounded-lg border bg-card p-3 text-left shadow-lg group-hover/tt:block">
                        <dl className="space-y-1.5 text-xs">
                          <div className="flex gap-2"><dt className="w-24 shrink-0 font-medium text-muted-foreground">Request ID</dt><dd className="text-foreground">#{t.ticketNumber}</dd></div>
                          <div className="flex gap-2"><dt className="w-24 shrink-0 font-medium text-muted-foreground">Category</dt><dd className="text-foreground">{t.ticketCategory || '—'}</dd></div>
                          <div className="flex gap-2"><dt className="w-24 shrink-0 font-medium text-muted-foreground">Subject</dt><dd className="text-foreground">{t.subject}</dd></div>
                          <div className="flex gap-2"><dt className="w-24 shrink-0 font-medium text-muted-foreground">Description</dt><dd className="line-clamp-5 whitespace-pre-wrap text-muted-foreground">{t.description || '—'}</dd></div>
                        </dl>
                      </div>
                    </div>

                    {/* Meta line 1 */}
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <span>DueBy Date : <span className="text-foreground">{due}</span></span>
                      {sep}
                      <span>Requester : <span className="text-foreground">{t.requestorName || '—'}</span></span>
                      {sep}
                      <InlineEdit
                        isAdmin={isAdmin}
                        label="Status"
                        value={t.ticketStatus}
                        display={<span className="text-foreground">{t.ticketStatus}</span>}
                        options={statusOpts.filter((o) => o.isActive !== false).map((o) => ({ value: o.value, node: o.label }))}
                        onChange={(v) => updateMutation.mutate({ id: t.id, data: { ticketStatus: v } })}
                      />
                      {sep}
                      <InlineEdit
                        isAdmin={isAdmin}
                        label="Priority"
                        value={t.priority ?? ''}
                        display={<><span className={`inline-block size-2.5 rounded-sm ${priority.barClass}`} /><span className="text-foreground">{priority.label} ({priority.code})</span></>}
                        options={priorityOpts.filter((o) => o.isActive !== false).map((o) => ({
                          value: o.value,
                          node: <span className="inline-flex items-center gap-2"><span className={`inline-block size-2.5 rounded-sm ${getPriorityMeta(o.value).barClass}`} />{o.label}</span>,
                        }))}
                        onChange={(v) => updateMutation.mutate({ id: t.id, data: { priority: v } })}
                      />
                    </div>

                    {/* Meta line 2 */}
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      {t.customerCompany && (<><span>Customer : <span className="text-foreground">{t.customerCompany.name}</span></span>{sep}</>)}
                      {t.department && (<><span>Department : <span className="text-foreground">{t.department}</span></span>{sep}</>)}
                      {t.ticketCategory && (<><span>Category : <span className="text-foreground">{t.ticketCategory}</span></span>{sep}</>)}
                      <AssignedTo
                        ticket={t}
                        isAdmin={isAdmin}
                        users={assignableUsers}
                        onAssign={(userIds) => assignMutation.mutate({ id: t.id, userIds })}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
    </div>
  );
}

function InlineEdit({
  isAdmin,
  label,
  value,
  display,
  options,
  onChange,
}: {
  isAdmin: boolean;
  label: string;
  value: string;
  display: ReactNode;
  options: { value: string; node: ReactNode }[];
  onChange: (value: string) => void;
}) {
  if (!isAdmin) {
    return <span className="inline-flex items-center gap-1.5">{label} : {display}</span>;
  }
  return (
    <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      {label} :
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded underline-offset-2 outline-none hover:underline focus-visible:underline"
          >
            {display}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-72 w-52 overflow-y-auto">
          <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
            {options.map((o) => (
              <DropdownMenuRadioItem key={o.value} value={o.value}>{o.node}</DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}

function AssignedTo({
  ticket,
  isAdmin,
  users,
  onAssign,
}: {
  ticket: TicketSummary;
  isAdmin: boolean;
  users: UserOption[];
  onAssign: (userIds: string[]) => void;
}) {
  const assignedIds = ticket.technicians.map((x) => x.user.id);
  const label = ticket.technicians.map((x) => x.user.username).join(', ') || 'Unassigned';

  // Agents just see the assignee text.
  if (!isAdmin) {
    return <span>Assigned To : <span className="text-foreground">{label}</span></span>;
  }

  const toggle = (id: string, checked: boolean) =>
    onAssign(checked ? [...assignedIds, id] : assignedIds.filter((x) => x !== id));

  return (
    // Stop row navigation when interacting with the assignee control.
    <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      Assigned To :
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="rounded text-foreground underline-offset-2 outline-none hover:underline focus-visible:underline"
          >
            {label}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-72 w-56 overflow-y-auto">
          <DropdownMenuLabel>Assign technicians</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {users.length === 0 && (
            <div className="px-2 py-1.5 text-sm text-muted-foreground">No users available.</div>
          )}
          {users.map((u) => (
            <DropdownMenuCheckboxItem
              key={u.id}
              checked={assignedIds.includes(u.id)}
              onCheckedChange={(c) => toggle(u.id, !!c)}
              onSelect={(e) => e.preventDefault()}
            >
              {u.username}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}
