import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getPriorityMeta, isTerminalStatus, type TicketSummary } from './ticketHelpers';

interface TemplateSummary { id: string; name: string; }

type ViewKey = 'all' | 'mine' | 'overdue' | 'unassigned';
type SortKey = 'newest' | 'oldest' | 'priority' | 'due';

const PRIORITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export default function TicketListPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const typeFilter = searchParams.get('type') ?? '';

  const [view, setView] = useState<ViewKey>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [sort, setSort] = useState<SortKey>('newest');

  const { data: tickets = [], isLoading } = useQuery<TicketSummary[]>({
    queryKey: ['tickets'],
    queryFn: async () => (await api.get('/api/tickets')).data,
  });
  const { data: templates = [] } = useQuery<TemplateSummary[]>({
    queryKey: ['templates'],
    queryFn: async () => (await api.get('/api/templates')).data,
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
  }), [byType, user?.id]);

  const filtered = useMemo(() => {
    let list = byType;
    if (view === 'mine') list = list.filter((t) => t.technicians.some((tt) => tt.user.id === user?.id));
    if (view === 'overdue') list = list.filter((t) => !isTerminalStatus(t.ticketStatus) && t.dueDate && new Date(t.dueDate) < new Date());
    if (view === 'unassigned') list = list.filter((t) => t.technicians.length === 0);
    if (priorityFilter !== 'all') list = list.filter((t) => (t.priority ?? '').toLowerCase() === priorityFilter);
    if (categoryFilter !== 'all') list = list.filter((t) => t.ticketCategory === categoryFilter);
    return list;
  }, [byType, view, priorityFilter, categoryFilter, user?.id]);

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
    { key: 'all', label: 'All requests', count: viewCounts.all },
    { key: 'mine', label: 'Assigned to me', count: viewCounts.mine },
    { key: 'overdue', label: 'Overdue', count: viewCounts.overdue },
    { key: 'unassigned', label: 'Unassigned', count: viewCounts.unassigned },
  ];

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{typeFilter || 'All requests'}</h1>
          <p className="text-sm text-muted-foreground">{sorted.length} of {tickets.length}</p>
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

      {/* Filters + sort */}
      <div className="mb-5 flex flex-wrap items-center gap-2 py-3">
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

      {isLoading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : (
        <div className="divide-y border-y">
            {sorted.length === 0 && <p className="p-6 text-center text-muted-foreground">No tickets match this view.</p>}
            {sorted.map((t) => {
              const priority = getPriorityMeta(t.priority);
              return (
                <Link
                  key={t.id}
                  to={`/tickets/${t.id}`}
                  className="flex items-stretch gap-3 px-4 py-3 transition-colors hover:bg-accent"
                >
                  <div className={`w-1 shrink-0 rounded-full ${priority.barClass}`} />
                  <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-foreground">
                        <span className="text-muted-foreground">#{t.ticketNumber}</span> {t.subject}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {t.requestorName || 'Unknown requestor'}
                        {t.ticketCategory ? ` · ${t.ticketCategory}` : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                      <Badge variant="secondary">{t.ticketStatus}</Badge>
                      <span className={priority.textClass}>{priority.label} · {priority.code}</span>
                      <span className="w-28 shrink-0 text-right text-muted-foreground">
                        {t.technicians[0]?.user.username ?? 'Unassigned'}
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
    </div>
  );
}
