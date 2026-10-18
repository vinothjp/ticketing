import { useMemo, useState, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ListChecks, FolderKanban, ChevronDown, ChevronUp } from 'lucide-react';
import api from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useDateFormat } from '../lib/dateFormat';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getPriorityMeta, formatDueStatus, isTerminalStatus, isOverdueTicket, isCreatedTodayTicket, type TicketSummary } from './tickets/ticketHelpers';

interface UserOption { id: string; username: string; }
interface MyTask {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  dueDate?: string | null;
  ticket: { id: string; ticketNumber: string; subject: string; ticketStatus: string; priority?: string | null };
}

interface MyProjectTask {
  id: string;
  title: string;
  status: string;
  dueDate: string | null;
  taskNumber: number | null;
  project: { id: string; name: string; key: string | null };
}
interface ProjectSummary { active: number; onTrack: number; atRisk: number; offTrack: number }

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/** How many rows each dashboard list shows before "Show all". */
const QUEUE_LIMIT = 6;
const TASK_LIMIT = 5;

const DAY = 86_400_000;
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
/** Most urgent first: overdue (oldest first), then by due date; undated last. */
const byUrgency = (a: { dueDate?: string | null }, b: { dueDate?: string | null }) => {
  const da = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
  const db = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
  return da - db;
};

/** "Show all N" / "Show less" under a capped list; renders nothing when the list fits. */
function ShowAll({ total, limit, expanded, onToggle }: { total: number; limit: number; expanded: boolean; onToggle: () => void }) {
  if (total <= limit) return null;
  return (
    <button type="button" onClick={onToggle} className="mt-2 flex items-center gap-1 text-sm font-medium text-primary hover:underline">
      {expanded ? <>Show less <ChevronUp className="size-4" /></> : <>Show all {total} <ChevronDown className="size-4" /></>}
    </button>
  );
}

// Preferred display order for the per-status breakdown row; unknown statuses append after.
const STATUS_ORDER = [
  'Open', 'Assigned', 'In Progress', 'On Hold',
  'Awaiting Vendor Update', 'Awaiting End-user Response',
  'Approval Pending', 'Resolved', 'Closed',
];
// Friendlier labels for a few status boxes (value stays the real status).
const STATUS_LABELS: Record<string, string> = { Open: 'Open tickets' };

export default function DashboardPage() {
  const { user } = useAuth();
  const isAdmin = !!user?.roles.includes('Admin');
  const isCustomerAdmin = !!user?.roles.includes('CustomerAdmin');
  // Tasks are internal (agent-to-agent); customers never see them.
  const isCustomer = (!!user?.roles.includes('Customer') || isCustomerAdmin) && !isAdmin;

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
    enabled: !isCustomer,
  });

  // Projects — staff only. Projects run across months, so neither query follows the
  // month filter; "My project tasks" does follow the admin's agent filter.
  const { data: projectSummary } = useQuery<ProjectSummary>({
    queryKey: ['projects', 'dashboard-summary'],
    queryFn: async () => (await api.get('/api/projects/dashboard-summary')).data,
    enabled: !isCustomer,
  });
  const { data: myProjectTasks = [] } = useQuery<MyProjectTask[]>({
    queryKey: ['project-my-tasks', isAdmin && agentId !== 'all' ? agentId : 'me'],
    queryFn: async () => (await api.get('/api/projects/my-tasks', {
      params: isAdmin && agentId !== 'all' ? { assignee: agentId } : undefined,
    })).data,
    enabled: !isCustomer,
  });
  const { fmtDate } = useDateFormat();
  const [showAllQueue, setShowAllQueue] = useState(false);
  const [showAllTasks, setShowAllTasks] = useState(false);
  const [showAllProjectTasks, setShowAllProjectTasks] = useState(false);

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

  // Ticket count per status (within the selected month/agent scope).
  // A fixed baseline is always shown (even at 0) so every dashboard — admin,
  // agent, customer — has the same boxes; other statuses append only if present.
  const statusBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of scoped) counts[t.ticketStatus] = (counts[t.ticketStatus] ?? 0) + 1;
    const base = ['Open', 'Resolved', 'Closed'];
    // 'Approval Pending' is surfaced as a small "needs approval" flag by the
    // heading instead of a full status card.
    const hidden = new Set(['New', 'Approval Pending']);
    const extras = [
      ...STATUS_ORDER.filter((s) => counts[s] && !base.includes(s) && !hidden.has(s)),
      ...Object.keys(counts).filter((s) => !STATUS_ORDER.includes(s) && !base.includes(s) && !hidden.has(s)),
    ];
    return [...base, ...extras].map((status) => ({ status, count: counts[status] ?? 0 }));
  }, [scoped]);

  // Overdue = past due date and not yet resolved/closed (a condition, not a status).
  const overdueCount = useMemo(() => scoped.filter(isOverdueTicket).length, [scoped]);

  // Raised today and not already overdue — the fresh half of the queue.
  const createdTodayCount = useMemo(() => scoped.filter(isCreatedTodayTicket).length, [scoped]);


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

  // Incoming order — newest arrivals lead, matching the ticket list default. Sorting by due
  // date instead pinned the overdue backlog to the top and buried anything just raised.
  // The first QUEUE_LIMIT show; "Show all" expands the rest in place.
  const queue = useMemo(
    () => [...stats.open].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [stats.open],
  );
  const queueShown = showAllQueue ? queue : queue.slice(0, QUEUE_LIMIT);

  // Task lists lead with what needs doing first, so the capped top rows are the right ones.
  const urgentTasks = useMemo(() => [...scopedTasks].sort(byUrgency), [scopedTasks]);
  const tasksShown = showAllTasks ? urgentTasks : urgentTasks.slice(0, TASK_LIMIT);
  const urgentProjectTasks = useMemo(() => [...myProjectTasks].sort(byUrgency), [myProjectTasks]);
  const projectTasksShown = showAllProjectTasks ? urgentProjectTasks : urgentProjectTasks.slice(0, TASK_LIMIT);

  /** "3d overdue" / "due today" / "due 18/10/2026", with the tone that goes with it. */
  const dueLabel = (due: string | null) => {
    if (!due) return { text: 'no due date', tone: 'text-muted-foreground', bar: 'bg-muted-foreground/40' };
    const days = Math.floor((startOfToday() - new Date(due).setHours(0, 0, 0, 0)) / DAY);
    if (days > 0) return { text: `${days}d overdue`, tone: 'text-destructive', bar: 'bg-destructive' };
    if (days === 0) return { text: 'due today', tone: 'text-amber-600 dark:text-amber-400', bar: 'bg-amber-500' };
    return { text: `due ${fmtDate(due)}`, tone: 'text-muted-foreground', bar: 'bg-muted-foreground/40' };
  };

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

      <div className={`mb-8 grid grid-cols-2 gap-4 ${isCustomer ? 'lg:grid-cols-4' : 'lg:grid-cols-5'}`}>
        <Link to="/tickets" className="rounded-lg bg-muted/50 p-4 transition-colors hover:bg-muted">
          <div className="text-sm text-muted-foreground">Unresolved</div>
          <div className="mt-1 text-3xl font-bold text-foreground">{isLoading ? '—' : stats.open.length}</div>
        </Link>
        {!isCustomer && (
          <Link to="/tickets?view=tasks" className="rounded-lg bg-muted/50 p-4 transition-colors hover:bg-muted">
            <div className="text-sm text-muted-foreground">Open tasks</div>
            <div className="mt-1 text-3xl font-bold text-foreground">{scopedTasks.length}</div>
          </Link>
        )}
        <Link to="/tickets" className="rounded-lg bg-muted/50 p-4 transition-colors hover:bg-muted">
          <div className="text-sm text-muted-foreground">Due today</div>
          <div className="mt-1 text-3xl font-bold text-foreground">{isLoading ? '—' : stats.dueToday.length}</div>
        </Link>
        <Link to="/tickets?view=overdue" className={stats.slaAtRisk.length > 0 ? 'rounded-lg bg-destructive/10 p-4 transition-colors hover:bg-destructive/20' : 'rounded-lg bg-muted/50 p-4 transition-colors hover:bg-muted'}>
          <div className={stats.slaAtRisk.length > 0 ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>SLA at risk</div>
          <div className={stats.slaAtRisk.length > 0 ? 'mt-1 text-3xl font-bold text-destructive' : 'mt-1 text-3xl font-bold text-foreground'}>
            {isLoading ? '—' : stats.slaAtRisk.length}
          </div>
        </Link>
        <div className="rounded-lg bg-muted/50 p-4">
          <div className="text-sm text-muted-foreground">Avg. resolution</div>
          <div className="mt-1 text-3xl font-bold text-foreground">
            {stats.avgResolutionHrs == null ? '—' : `${stats.avgResolutionHrs.toFixed(1)}h`}
          </div>
        </div>
      </div>

      {/* Per-status breakdown — same card style/size as the KPI row, click to filter the list.
          The two condition tiles (Created today / Overdue) ride along at the end, so the desktop
          column count is taken from the real tile count: one evenly-sized row, no wrapping,
          however many statuses the tenant actually uses. */}
      {statusBreakdown.length > 0 && (
        <div className="mb-8">
          <div className="mb-2 text-sm font-medium text-muted-foreground">By status</div>
          <div
            className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:[grid-template-columns:repeat(var(--status-tiles),minmax(0,1fr))]"
            style={{ '--status-tiles': statusBreakdown.length + 2 } as CSSProperties}
          >
            {statusBreakdown.map((s) => (
              <Link
                key={s.status}
                to={`/tickets?status=${encodeURIComponent(s.status)}`}
                className="rounded-lg bg-muted/50 p-4 transition-colors hover:bg-muted"
              >
                <div className="truncate text-sm text-muted-foreground" title={s.status}>{STATUS_LABELS[s.status] ?? s.status}</div>
                <div className="mt-1 text-3xl font-bold text-foreground">{s.count}</div>
              </Link>
            ))}
            <Link to="/tickets?view=today" className="rounded-lg bg-muted/50 p-4 transition-colors hover:bg-muted">
              <div className="truncate text-sm text-muted-foreground">Created today</div>
              <div className="mt-1 text-3xl font-bold text-foreground">{createdTodayCount}</div>
            </Link>
            <Link to="/tickets?view=overdue" className="rounded-lg bg-muted/50 p-4 transition-colors hover:bg-muted">
              <div className="truncate text-sm text-muted-foreground">Overdue</div>
              <div className="mt-1 text-3xl font-bold text-foreground">{overdueCount}</div>
            </Link>
          </div>
        </div>
      )}

      {/* Projects — running projects by health, the same rule as Project Analytics.
          Staff only; like the ticket tiles, each opens the Projects list — filtered to that health. */}
      {!isCustomer && projectSummary && (
        <div className="mb-8">
          <div className="mb-2 text-sm font-medium text-muted-foreground">Projects</div>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {[
              { label: 'Active projects', value: projectSummary.active, tone: 'text-foreground', to: '/projects' },
              { label: 'On track', value: projectSummary.onTrack, tone: 'text-emerald-600 dark:text-emerald-400', to: '/projects?health=on-track' },
              { label: 'At risk', value: projectSummary.atRisk, tone: 'text-amber-600 dark:text-amber-400', to: '/projects?health=at-risk' },
              { label: 'Off track', value: projectSummary.offTrack, tone: 'text-destructive', to: '/projects?health=off-track' },
            ].map((t) => (
              <Link key={t.label} to={t.to} className="rounded-lg bg-muted/50 p-4 transition-colors hover:bg-muted">
                <div className="truncate text-sm text-muted-foreground">{t.label}</div>
                <div className={`mt-1 text-3xl font-bold ${t.value ? t.tone : 'text-foreground'}`}>{t.value}</div>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className={`grid grid-cols-1 gap-6 ${isCustomer ? '' : 'lg:grid-cols-2'}`}>
      <section>
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-foreground">Ticket queue</h2>
            {!isLoading && <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground">{queue.length}</span>}
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link to="/tickets">All tickets</Link>
          </Button>
        </div>
        <div className="divide-y border-y">
          {isLoading && <p className="p-4 text-sm text-muted-foreground">Loading...</p>}
          {!isLoading && queue.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">No open tickets for this period.</p>
          )}
          {queueShown.map((t) => {
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
        <ShowAll total={queue.length} limit={QUEUE_LIMIT} expanded={showAllQueue} onToggle={() => setShowAllQueue((v) => !v)} />
      </section>

      {!isCustomer && (
      <div className="space-y-8">
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
            tasksShown.map((task) => {
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
        <ShowAll total={urgentTasks.length} limit={TASK_LIMIT} expanded={showAllTasks} onToggle={() => setShowAllTasks((v) => !v)} />
      </section>

      {/* Open project tasks assigned to me (or the agent picked above), across every running
          project — most urgent first. A click opens the task in its project. */}
      <section>
        <div className="mb-4 flex items-center gap-2">
          <FolderKanban className="size-4 text-muted-foreground" />
          <h2 className="text-base font-semibold text-foreground">My project tasks</h2>
          <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground">{urgentProjectTasks.length}</span>
        </div>
        <div className="divide-y border-y">
          {urgentProjectTasks.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No open project tasks.</p>
          ) : (
            projectTasksShown.map((task) => {
              const due = dueLabel(task.dueDate);
              return (
                <Link
                  key={task.id}
                  to={`/projects/${task.project.id}?tab=tasks&task=${task.id}`}
                  className="flex items-stretch gap-3 px-4 py-3 transition-colors hover:bg-accent"
                >
                  <div className={`w-1 shrink-0 rounded-full ${due.bar}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-foreground" title={task.title}>{task.title}</span>
                      <span className={`shrink-0 text-xs ${due.tone}`}>{due.text}</span>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground" title={task.project.name}>
                      {task.project.key && task.taskNumber != null && <span>{task.project.key}-{task.taskNumber} · </span>}
                      {task.project.name}
                    </div>
                  </div>
                </Link>
              );
            })
          )}
        </div>
        <ShowAll total={urgentProjectTasks.length} limit={TASK_LIMIT} expanded={showAllProjectTasks} onToggle={() => setShowAllProjectTasks((v) => !v)} />
      </section>
      </div>
      )}
      </div>
    </div>
  );
}
