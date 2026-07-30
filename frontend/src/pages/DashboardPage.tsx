import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getPriorityMeta, formatDueStatus, isTerminalStatus, type TicketSummary } from './tickets/ticketHelpers';

export default function DashboardPage() {
  const { data: tickets = [], isLoading } = useQuery<TicketSummary[]>({
    queryKey: ['tickets'],
    queryFn: async () => (await api.get('/api/tickets')).data,
  });

  const stats = useMemo(() => {
    const open = tickets.filter((t) => !isTerminalStatus(t.ticketStatus));
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
    const resolved = tickets.filter((t) => t.closedDate);
    const avgResolutionHrs = resolved.length
      ? resolved.reduce((sum, t) => sum + (new Date(t.closedDate!).getTime() - new Date(t.createdAt).getTime()), 0)
        / resolved.length / (1000 * 60 * 60)
      : null;

    return { open, dueToday, slaAtRisk, avgResolutionHrs };
  }, [tickets]);

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
      <h1 className="mb-6 text-2xl font-bold text-foreground">Dashboard</h1>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardContent className="py-5">
            <div className="text-sm text-muted-foreground">Open tickets</div>
            <div className="text-3xl font-bold text-foreground">{isLoading ? '—' : stats.open.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-5">
            <div className="text-sm text-muted-foreground">Due today</div>
            <div className="text-3xl font-bold text-foreground">{isLoading ? '—' : stats.dueToday.length}</div>
          </CardContent>
        </Card>
        <Card className={stats.slaAtRisk.length > 0 ? 'border-destructive/40 bg-destructive/5' : undefined}>
          <CardContent className="py-5">
            <div className={stats.slaAtRisk.length > 0 ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>SLA at risk</div>
            <div className={stats.slaAtRisk.length > 0 ? 'text-3xl font-bold text-destructive' : 'text-3xl font-bold text-foreground'}>
              {isLoading ? '—' : stats.slaAtRisk.length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-5">
            <div className="text-sm text-muted-foreground">Avg. resolution</div>
            <div className="text-3xl font-bold text-foreground">
              {stats.avgResolutionHrs == null ? '—' : `${stats.avgResolutionHrs.toFixed(1)}h`}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Ticket queue</CardTitle>
          <Button asChild variant="ghost" size="sm">
            <Link to="/tickets">All requests</Link>
          </Button>
        </CardHeader>
        <CardContent className="divide-y p-0">
          {isLoading && <p className="p-4 text-sm text-muted-foreground">Loading...</p>}
          {!isLoading && queue.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">No open tickets right now.</p>
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
                    <Badge variant="outline">{t.requestType.name}</Badge>
                    {t.ticketCategory && <Badge variant="outline">{t.ticketCategory}</Badge>}
                  </div>
                </div>
              </Link>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
