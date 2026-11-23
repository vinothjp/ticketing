import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../lib/api';
import { isTerminalStatus, type TicketSummary } from '../tickets/ticketHelpers';
import type { ChangeRequestSummary } from '../change-requests/changeRequestMeta';

/**
 * Everything the two ITSM dashboards show, computed here from the same list
 * endpoints the screens they link to read — so a number on a tile is always the
 * list behind it. Nothing on these dashboards is typed in or sampled.
 *
 * The one figure the data has no home for is the SLA target: the tenant sets
 * resolution hours per policy, not a compliance goal, so the goal the trend line
 * and the insights measure against lives here.
 */
export const SLA_TARGET = 95;

export interface DateRange { from: Date; to: Date }

export interface AmcRow {
  id: string;
  customerCompanyId: string;
  contractNo: string | null;
  customer: string;
  product: string | null;
  expiryDate: string;
  daysLeft: number;
}

interface ProjectTaskLite { id: string; status: string; dueDate: string | null; completionPct: number; parentTaskId: string | null }
export interface ProjectLite {
  id: string;
  name: string;
  key?: string | null;
  status: string;
  isActive: boolean;
  progress: number;
  health: 'GREEN' | 'AMBER' | 'RED' | null;
  endDate?: string | null;
  tasks: ProjectTaskLite[];
}
interface CompanyLite { id: string; name: string }

export interface Filters {
  range: DateRange;
  customerId: string; // 'all' or a CustomerCompany id
  department: string; // 'all' or a ticket department
}

const DAY = 86_400_000;
export const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
export const endOfDay = (d: Date) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };
export const monthRange = (d: Date): DateRange => ({
  from: new Date(d.getFullYear(), d.getMonth(), 1),
  to: endOfDay(new Date(d.getFullYear(), d.getMonth() + 1, 0)),
});
const inRange = (iso: string | null | undefined, r: DateRange) => {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= r.from.getTime() && t <= r.to.getTime();
};
/** The period of the same length immediately before `r`, for the tiles' deltas. */
const previousRange = (r: DateRange): DateRange => {
  const len = r.to.getTime() - r.from.getTime();
  return { from: new Date(r.from.getTime() - len - 1), to: new Date(r.from.getTime() - 1) };
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** The `n` calendar months ending with the one `to` falls in, oldest first. */
const lastMonths = (to: Date, n: number) =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date(to.getFullYear(), to.getMonth() - (n - 1 - i), 1);
    return { label: MONTHS[d.getMonth()], range: monthRange(d) };
  });

/** % change, rounded to one place; null when there is nothing to compare against. */
const pctChange = (now: number, before: number) =>
  before === 0 ? null : Math.round(((now - before) / before) * 1000) / 10;
const pct = (n: number, d: number) => (d === 0 ? null : Math.round((n / d) * 1000) / 10);

const agentName = (u: { username: string; name?: string | null }) => u.name || u.username;

function ticketStats(list: TicketSummary[]) {
  const resolved = list.filter((t) => isTerminalStatus(t.ticketStatus));
  const hours = resolved
    .filter((t) => t.closedDate)
    .map((t) => (new Date(t.closedDate!).getTime() - new Date(t.createdAt).getTime()) / 3_600_000)
    .filter((h) => h >= 0);
  const timed = resolved.filter((t) => t.closedDate && t.dueDate);
  const met = timed.filter((t) => new Date(t.closedDate!) <= new Date(t.dueDate!)).length;
  const now = Date.now();
  return {
    total: list.length,
    resolved: resolved.length,
    open: list.length - resolved.length,
    avgHours: hours.length ? hours.reduce((s, h) => s + h, 0) / hours.length : null,
    sla: pct(met, timed.length),
    // Exceptions: still open and already past the SLA due date.
    exceptions: list.filter((t) => !isTerminalStatus(t.ticketStatus) && t.dueDate && new Date(t.dueDate).getTime() < now).length,
  };
}

/** Per assignee: tickets they hold in the period, and how many of those are resolved. */
function agentStats(list: TicketSummary[]) {
  const by = new Map<string, { id: string; name: string; assigned: number; resolved: number }>();
  for (const t of list) {
    for (const tech of t.technicians ?? []) {
      const u = (tech as { user?: { id: string; username: string; name?: string | null } }).user;
      if (!u) continue;
      const row = by.get(u.id) ?? { id: u.id, name: agentName(u), assigned: 0, resolved: 0 };
      row.assigned++;
      if (isTerminalStatus(t.ticketStatus)) row.resolved++;
      by.set(u.id, row);
    }
  }
  return [...by.values()].sort((a, b) => b.assigned - a.assigned || b.resolved - a.resolved);
}

const PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;
const issueOf = (t: TicketSummary) => t.ticketCategory || t.template?.category || t.template?.name || 'Uncategorised';

export function useItsmData(filters: Filters, trendMonths = 6) {
  const { range, customerId, department } = filters;

  const tickets = useQuery<TicketSummary[]>({ queryKey: ['tickets'], queryFn: async () => (await api.get('/api/tickets')).data });
  const crs = useQuery<ChangeRequestSummary[]>({
    queryKey: ['change-requests', 'itsm'],
    queryFn: async () => (await api.get('/api/change-requests')).data,
  });
  const projects = useQuery<ProjectLite[]>({ queryKey: ['projects', 'itsm'], queryFn: async () => (await api.get('/api/projects')).data });
  const amc = useQuery<AmcRow[]>({
    queryKey: ['amc-expiring'],
    queryFn: async () => (await api.get('/api/customer-companies/amc-expiring')).data,
  });
  // Assignees carry only a username on the ticket list; the Users list has the full name.
  const users = useQuery<{ id: string; username: string; name?: string | null }[]>({
    queryKey: ['users'],
    queryFn: async () => (await api.get('/api/users')).data,
  });
  const companies = useQuery<CompanyLite[]>({
    queryKey: ['customer-companies', 'itsm-filter'],
    queryFn: async () => (await api.get('/api/customer-companies')).data,
  });

  const data = useMemo(() => {
    const all = (tickets.data ?? []).filter(
      (t) =>
        (customerId === 'all' || t.customerCompany?.id === customerId) &&
        (department === 'all' || (t.department ?? '') === department),
    );
    const cur = all.filter((t) => inRange(t.createdAt, range));
    const prevR = previousRange(range);
    const prev = all.filter((t) => inRange(t.createdAt, prevR));
    const s = ticketStats(cur);
    const p = ticketStats(prev);

    const kpis = {
      ...s,
      totalDelta: pctChange(s.total, p.total),
      resolvedDelta: pctChange(s.resolved, p.resolved),
      openDelta: pctChange(s.open, p.open),
      avgDelta: s.avgHours != null && p.avgHours != null ? pctChange(s.avgHours, p.avgHours) : null,
      slaDelta: s.sla != null && p.sla != null ? Math.round((s.sla - p.sla) * 10) / 10 : null,
      exceptionsDelta: pctChange(s.exceptions, p.exceptions),
    };

    const names = new Map((users.data ?? []).map((u) => [u.id, agentName(u)]));
    const named = <T extends { id: string; name: string }>(rows: T[]) => rows.map((r) => ({ ...r, name: names.get(r.id) ?? r.name }));
    const agents = named(agentStats(cur));
    const prevAgents = agentStats(prev);
    const team = agents.reduce((a, r) => ({ assigned: a.assigned + r.assigned, resolved: a.resolved + r.resolved }), { assigned: 0, resolved: 0 });
    const prevTeam = prevAgents.reduce((a, r) => ({ assigned: a.assigned + r.assigned, resolved: a.resolved + r.resolved }), { assigned: 0, resolved: 0 });
    const ranked = agents.filter((a) => a.assigned > 0).sort((a, b) => b.resolved / b.assigned - a.resolved / a.assigned || b.resolved - a.resolved);

    // Month series end at the month the selected range ends in.
    const months = lastMonths(range.to, trendMonths).map((m) => {
      const list = all.filter((t) => inRange(t.createdAt, m.range));
      const st = ticketStats(list);
      return {
        label: m.label,
        created: st.total,
        resolved: st.resolved,
        backlog: st.open,
        sla: st.sla,
        resolvedPct: pct(st.resolved, st.total),
      };
    });

    const openNow = all.filter((t) => !isTerminalStatus(t.ticketStatus));
    const queue = PRIORITIES.map((pr) => ({ priority: pr, count: openNow.filter((t) => (t.priority ?? '').toLowerCase() === pr).length }));

    const issueCounts = new Map<string, number>();
    for (const t of cur) issueCounts.set(issueOf(t), (issueCounts.get(issueOf(t)) ?? 0) + 1);
    const sortedIssues = [...issueCounts.entries()].sort((a, b) => b[1] - a[1]);
    const top = sortedIssues.slice(0, 4);
    const others = sortedIssues.slice(4).reduce((n, [, c]) => n + c, 0);
    const issues = [...top, ...(others ? [['Others', others] as [string, number]] : [])].map(([name, count]) => ({
      name, count, pct: cur.length ? Math.round((count / cur.length) * 100) : 0,
    }));

    // ---- Projects: current state, not the date range (projects run across months) ----
    const companyName = customerId === 'all' ? null : companies.data?.find((c) => c.id === customerId)?.name ?? null;
    const running = (projects.data ?? []).filter((pr) => pr.isActive && pr.status !== 'COMPLETED' && pr.status !== 'CANCELLED');
    const health = {
      running: running.length,
      onTrack: running.filter((pr) => pr.health === 'GREEN').length,
      atRisk: running.filter((pr) => pr.health === 'AMBER').length,
      delayed: running.filter((pr) => pr.health === 'RED').length,
      avgProgress: running.length ? Math.round(running.reduce((n, pr) => n + (pr.progress ?? 0), 0) / running.length) : null,
    };
    // Task targets: leaf work items due inside the period, and how many of them are done.
    const leaves = (projects.data ?? []).flatMap((pr) => {
      const parents = new Set(pr.tasks.map((t) => t.parentTaskId).filter(Boolean));
      return pr.tasks.filter((t) => !parents.has(t.id));
    });
    const dueIn = (r: DateRange) => leaves.filter((t) => inRange(t.dueDate, r));
    const due = dueIn(range);
    const prevDue = dueIn(prevR);
    const taskTargets = {
      target: due.length,
      achieved: due.filter((t) => t.status === 'COMPLETED').length,
      prevAchieved: prevDue.filter((t) => t.status === 'COMPLETED').length,
      runningTasks: running.flatMap((pr) => {
        const parents = new Set(pr.tasks.map((t) => t.parentTaskId).filter(Boolean));
        return pr.tasks.filter((t) => !parents.has(t.id));
      }),
    };

    // ---- Change requests, created inside the period ----
    const crList = (crs.data ?? []).filter(
      (c) => inRange(c.createdAt, range) && (!companyName || c.customer === companyName),
    );

    const amcRows = (amc.data ?? []).filter((r) => customerId === 'all' || r.customerCompanyId === customerId);
    const amcSummary = {
      within30: amcRows.filter((r) => r.daysLeft <= 30).length,
      within60: amcRows.filter((r) => r.daysLeft > 30 && r.daysLeft <= 60).length,
      rows: amcRows,
    };

    const departments = [...new Set((tickets.data ?? []).map((t) => t.department).filter((d): d is string => !!d))].sort();

    return {
      kpis, agents, team, prevTeam, ranked, months, queue, issues, health, taskTargets, crList, amc: amcSummary,
      departments, companies: companies.data ?? [], projects: running,
    };
  }, [tickets.data, crs.data, projects.data, amc.data, companies.data, users.data, range, customerId, department, trendMonths]);

  return { ...data, isLoading: tickets.isLoading };
}

export const PRIORITY_KEYS = PRIORITIES;

// ---------------------------------------------------------------- date presets

export type RangeKey = 'this-month' | 'last-month' | 'last-3' | 'last-6' | 'this-year';
export const RANGE_KEYS: { value: RangeKey; label: string }[] = [
  { value: 'this-month', label: 'This month' },
  { value: 'last-month', label: 'Last month' },
  { value: 'last-3', label: 'Last 3 months' },
  { value: 'last-6', label: 'Last 6 months' },
  { value: 'this-year', label: 'This year' },
];
/** Whole calendar months, so the previous-period deltas compare like with like. */
export function rangeFor(key: RangeKey, now = new Date()): DateRange {
  const y = now.getFullYear(), m = now.getMonth();
  const span = (back: number, months: number) => ({
    from: new Date(y, m - back, 1),
    to: endOfDay(new Date(y, m - back + months, 0)),
  });
  switch (key) {
    case 'last-month': return span(1, 1);
    case 'last-3': return span(2, 3);
    case 'last-6': return span(5, 6);
    case 'this-year': return { from: new Date(y, 0, 1), to: endOfDay(new Date(y, 11, 31)) };
    default: return span(0, 1);
  }
}

// ---------------------------------------------------------------- insights

export type Insight = { tone: 'ok' | 'info' | 'warn'; text: string };
type ItsmData = ReturnType<typeof useItsmData>;

/** Plain-language lines for the Insights panels — each one only when its figure exists. */
export function buildInsights(d: ItsmData, opts: { topIssue?: boolean } = {}): Insight[] {
  const out: Insight[] = [];
  const { kpis } = d;
  if (kpis.sla != null) {
    out.push(kpis.sla >= SLA_TARGET
      ? { tone: 'ok', text: `SLA is on track at ${kpis.sla}% (target ≥ ${SLA_TARGET}%).` }
      : { tone: 'warn', text: `SLA is at ${kpis.sla}% — below the ${SLA_TARGET}% target.` });
  }
  if (d.amc.within30 > 0) {
    out.push({ tone: 'info', text: `${d.amc.within30} AMC contract${d.amc.within30 === 1 ? ' is' : 's are'} expiring within the next 30 days.` });
  } else {
    out.push({ tone: 'ok', text: 'No AMC contracts expire in the next 30 days.' });
  }
  if (kpis.openDelta != null && kpis.openDelta !== 0) {
    out.push(kpis.openDelta < 0
      ? { tone: 'ok', text: `Open tickets decreased by ${Math.abs(kpis.openDelta)}% compared to the previous period.` }
      : { tone: 'warn', text: `Open tickets increased by ${kpis.openDelta}% compared to the previous period.` });
  }
  if (kpis.exceptions > 0) {
    out.push({ tone: 'warn', text: `${kpis.exceptions} open ticket${kpis.exceptions === 1 ? ' is' : 's are'} past the SLA due date.` });
  }
  if (d.health.avgProgress != null) {
    out.push({ tone: 'ok', text: `Project completion is at ${d.health.avgProgress}% across ${d.health.running} running project${d.health.running === 1 ? '' : 's'}.` });
  }
  if (opts.topIssue && d.issues[0] && d.issues[0].name !== 'Others') {
    out.push({ tone: 'ok', text: `Top issue: ${d.issues[0].name} (${d.issues[0].pct}%).` });
  }
  if (!out.length) out.push({ tone: 'info', text: 'No activity in this period yet.' });
  return out;
}
export { DAY, pct };

// ---------------------------------------------------------------- links

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** The ticket list, opened on the same created-date range (plus any filters) a tile counted. */
export function ticketsLink(range: DateRange | null, extra: Record<string, string> = {}) {
  const p = new URLSearchParams(range ? { from: ymd(range.from), to: ymd(range.to), ...extra } : extra);
  return `/tickets?${p}`;
}
export const OPEN = '__open__';
export const SETTLED = '__settled__';
