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

interface RequestType { id: string; name: string; }

type ViewKey = 'all' | 'mine' | 'overdue' | 'unassigned';
type SortKey = 'newest' | 'oldest' | 'priority' | 'due';

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

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
  const { data: requestTypes = [] } = useQuery<RequestType[]>({
    queryKey: ['request-types'],
    queryFn: async () => (await api.get('/api/request-types')).data,
  });

  const categories = useMemo(
    () => Array.from(new Set(tickets.map((t) => t.ticketCategory).filter((c): c is string => !!c))),
    [tickets],
  );

  const byType = useMemo(
    () => (typeFilter ? tickets.filter((t) => t.requestType.name === typeFilter) : tickets),
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
    <div className="grid grid-cols-[220px_1fr] gap-6">
      <aside className="space-y-6">
        <div>
          <div className="mb-2 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Views</div>
          <div className="flex flex-col gap-1">
            {views.map((v) => (
              <button
                key={v.key}
                type="button"
                onClick={() => setView(v.key)}
                className={cn(
                  'flex items-center justify-between rounded-lg px-3 py-1.5 text-left text-sm transition-colors hover:bg-accent',
                  view === v.key && 'bg-primary/10 font-medium text-primary',
                )}
              >
                {v.label}
                <span className="text-xs text-muted-foreground">{v.count}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Filter</div>
          <div className="space-y-2">
            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All priorities</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={typeFilter || 'all'} onValueChange={(v) => setSearchParams(v === 'all' ? {} : { type: v })}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All request types</SelectItem>
                {requestTypes.map((rt) => <SelectItem key={rt.id} value={rt.name}>{rt.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </aside>

      <div>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">{typeFilter || 'All requests'}</h1>
            <p className="text-sm text-muted-foreground">{sorted.length} of {tickets.length}</p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest first</SelectItem>
                <SelectItem value="oldest">Oldest first</SelectItem>
                <SelectItem value="priority">Priority</SelectItem>
                <SelectItem value="due">Due date</SelectItem>
              </SelectContent>
            </Select>
            <Button asChild>
              <Link to="/tickets/new"><Plus className="size-4" /> New request</Link>
            </Button>
          </div>
        </div>

        {isLoading ? (
          <p className="text-muted-foreground">Loading...</p>
        ) : (
          <div className="divide-y rounded-xl border bg-card">
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
    </div>
  );
}
