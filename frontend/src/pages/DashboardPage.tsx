import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ListChecks } from 'lucide-react';
import api from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getPriorityMeta, formatDueStatus, isTerminalStatus, type TicketSummary } from './tickets/ticketHelpers';

interface UserOption { id: string; username: string; }
interface MyTask {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  dueDate?: string | null;
  ticket: { id: string; ticketNumber: string; subject: string; ticketStatus: string; priority?: string | null };
}

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

export default function DashboardPage() {
  const { user } = useAuth();
  const isAdmin = !!user?.roles.includes('Admin');

  // Month filter — defaults to the current month; last 12 months available.
  const [month, setMonth] = useState(monthKey(new Date()));
  const [agentId, setAgentId] = useState('all');

  const monthOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      opts.push({ value: monthKey(d), label: d.toLocaleString(undefined, { month: 'long', year: 'numeric' }) });
    }
    return opts;
  }, []);

  const { data: tickets = [], isLoading } = useQuery<TicketSummary[]>({
    queryKey: ['tickets'],
    queryFn: async () => (await api.get('/api/tickets')).data,
  });

  // Agent list for the admin-only agent filter.
  const { data: agents = [] } = useQuery<UserOption[]>({
    queryKey: ['users'],
    queryFn: async () => (await api.get('/api/users')).data,
    enabled: isAdmin,
  });

  // Open tasks assigned to the viewer (or, for admins with an agent selected, that agent).
  const { data: myTasks = [] } = useQuery<MyTask[]>({
    queryKey: ['my-tasks', isAdmin && agentId !== 'all' ? agentId : 'me'],
    queryFn: async () => (await api.get('/api/my-tasks', {
      params: isAdmin && agentId !== 'all' ? { assignee: agentId } : undefined,
    })).data,
  });

  // Scope tickets to the selected month (by created date) and, for admins, the selected agent.
  const scoped = useMemo(() => {
    let list = tickets.filter((t) => monthKey(new Date(t.createdAt)) === month);
    if (isAdmin && agentId !== 'all') {
      list = list.filter((t) => t.technicians.some((tt) => tt.user.id === agentId));
    }
    return list;
  }, [tickets, month, agentId, isAdmin]);

  // Open tasks for the selected month (by task created date), matching the ticket scope.
  const scopedTasks = useMemo(
    () => myTasks.filter((t) => monthKey(new Date(t.createdAt)) === month),
    [myTasks, month],
  );

  const stats = useMemo(() => {
    const open = scoped.filter((t) => !isTerminalStatus(t.ticketStatus));
    const now = new Date();
    const dueToday = open.filter((t) => {
      if (!t.dueDate) return false;
      const d = new Date(t.dueDate);
      return d.toDateString() === now.toDateString();
    });
    const slaAtRisk = open.filter((t) => {
      if (!t.dueDate) return false;
      const diffHrs = (new Date(t.dueDate).getTime() - now.getTime()) / (1000 * 60 * 60);
      return diffHrs < 4;
    });
    const resolved = scoped.filter((t) => t.closedDate);
    const avgResolutionHrs = resolved.length
      ? resolved.reduce((sum, t) => sum + (new Date(t.closedDate!).getTime() - new Date(t.createdAt).getTime()), 0)
        / resolved.length / (1000 * 60 * 60)
      : null;

    return { open, dueToday, slaAtRisk, avgResolutionHrs };
  }, [scoped]);

  const queue = useMemo(
    () => [...stats.open].sort((a, b) => {
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    }).slice(0, 6),
    [stats.open],
  );

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && (
            <Select value={agentId} onValueChange={setAgentId}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All agents</SelectItem>
                {agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.username}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              {monthOptions.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <div className="rounded-lg bg-muted/50 p-4">
          <div className="text-sm text-muted-foreground">Open tickets</div>
          <div className="mt-1 text-3xl font-bold text-foreground">{isLoading ? '—' : stats.open.length}</div>
        </div>
        <div className="rounded-lg bg-muted/50 p-4">
          <div className="text-sm text-muted-foreground">Open tasks</div>
          <div className="mt-1 text-3xl font-bold text-foreground">{scopedTasks.length}</div>
        </div>
        <div className="rounded-lg bg-muted/50 p-4">
          <div className="text-sm text-muted-foreground">Due today</div>
          <div className="mt-1 text-3xl font-bold text-foreground">{isLoading ? '—' : stats.dueToday.length}</div>
        </div>
        <div className={stats.slaAtRisk.length > 0 ? 'rounded-lg bg-destructive/10 p-4' : 'rounded-lg bg-muted/50 p-4'}>
          <div className={stats.slaAtRisk.length > 0 ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>SLA at risk</div>
          <div className={stats.slaAtRisk.length > 0 ? 'mt-1 text-3xl font-bold text-destructive' : 'mt-1 text-3xl font-bold text-foreground'}>
            {isLoading ? '—' : stats.slaAtRisk.length}
          </div>
        </div>
        <div className="rounded-lg bg-muted/50 p-4">
          <div className="text-sm text-muted-foreground">Avg. resolution</div>
          <div className="mt-1 text-3xl font-bold text-foreground">
            {stats.avgResolutionHrs == null ? '—' : `${stats.avgResolutionHrs.toFixed(1)}h`}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">Ticket queue</h2>
          <Button asChild variant="ghost" size="sm">
            <Link to="/tickets">All tickets</Link>
          </Button>
        </div>
        <div className="divide-y border-y">
          {isLoading && <p className="p-4 text-sm text-muted-foreground">Loading...</p>}
          {!isLoading && queue.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">No open tickets for this period.</p>
          )}
          {queue.map((t) => {
            const priority = getPriorityMeta(t.priority);
            const due = formatDueStatus(t.dueDate, t.ticketStatus);
            return (
              <Link
                key={t.id}
                to={`/tickets/${t.id}`}
                className="flex items-stretch gap-3 px-4 py-3 transition-colors hover:bg-accent"
              >
                <div className={`w-1 shrink-0 rounded-full ${priority.barClass}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <span className="text-xs text-muted-foreground">#{t.ticketNumber}</span>{' '}
                      <span className="font-medium text-foreground">{t.subject}</span>
                    </div>
                    <div className="shrink-0 text-right text-xs">
                      <div className={due.tone === 'overdue' ? 'text-destructive' : 'text-muted-foreground'}>{due.label}</div>
                      <div className="text-muted-foreground">{t.requestorName || 'Unassigned requestor'}</div>
                    </div>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <Badge variant={priority.code === 'P1' ? 'destructive' : 'secondary'}>{priority.label}</Badge>
                    <Badge variant="outline">{t.template?.name}</Badge>
                    {t.ticketCategory && <Badge variant="outline">{t.ticketCategory}</Badge>}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-center gap-2">
          <ListChecks className="size-4 text-muted-foreground" />
          <h2 className="text-base font-semibold text-foreground">Open tasks</h2>
          <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground">{scopedTasks.length}</span>
        </div>
        <div className="divide-y border-y">
          {scopedTasks.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No open tasks for this period.</p>
          ) : (
            scopedTasks.map((task) => {
              const priority = getPriorityMeta(task.ticket.priority);
              const due = task.dueDate
                ? new Date(task.dueDate).toLocaleString(undefined, { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })
                : null;
              return (
                <Link
                  key={task.id}
                  to={`/tickets/${task.ticket.id}`}
                  className="flex items-stretch gap-3 px-4 py-3 transition-colors hover:bg-accent"
                >
                  <div className={`w-1 shrink-0 rounded-full ${priority.barClass}`} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-foreground">{task.title}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      <span className="text-muted-foreground">#{task.ticket.ticketNumber}</span> {task.ticket.subject}
                      {due && <> · due {due}</>}
                    </div>
                  </div>
                </Link>
              );
            })
          )}
        </div>
      </section>
      </div>
    </div>
  );
}
