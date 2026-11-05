import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowLeft, HeartPulse, FolderKanban, TrendingUp, AlertTriangle, ListChecks, Banknote, Wallet, Percent } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import api from '../../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

/**
 * A column heading: its icon, then its label. Muted and small, so the headings
 * read as chrome and the values below them carry the weight. Mirrors the
 * Change Management list.
 */
function HeadLabel({ icon: Icon, children, className = '' }: {
  icon: LucideIcon; children: ReactNode; className?: string;
}) {
  return (
    <span className={`flex items-center gap-1.5 text-xs font-semibold text-muted-foreground ${className}`}>
      <Icon className="size-3.5 shrink-0" />
      {children}
    </span>
  );
}


interface ProjectRow {
  id: string; name: string; completed: number; inProgress: number; yetToStart: number; total: number;
  overdue: number; progress: number; revenue: number; cost: number; grossProfit: number; margin: number; rag: string;
}
interface Analytics {
  taskStatus: { completed: number; inProgress: number; yetToStart: number; total: number };
  byPriority: Record<string, number>;
  userWorkload: { name: string; count: number }[];
  perProject: ProjectRow[];
  portfolio: { revenue: number; cost: number; grossProfit: number; margin: number };
}

const money = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
const RAG_COLOR: Record<string, string> = { RED: 'bg-destructive', AMBER: 'bg-amber-500', GREEN: 'bg-success' };

const STATUS_COLORS = { inProgress: '#2563eb', yetToStart: '#7dd3fc', completed: '#f59e0b' };
const PRIORITY_ORDER = ['URGENT', 'HIGH', 'MEDIUM', 'LOW', 'NONE'];
const PRIORITY_LABEL: Record<string, string> = { URGENT: 'Urgent', HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low', NONE: '—' };

function Donut({ status }: { status: Analytics['taskStatus'] }) {
  const total = status.total || 1;
  const segs = [
    { key: 'inProgress', label: 'Work in Progress', value: status.inProgress, color: STATUS_COLORS.inProgress },
    { key: 'yetToStart', label: 'Yet to Start', value: status.yetToStart, color: STATUS_COLORS.yetToStart },
    { key: 'completed', label: 'Completed', value: status.completed, color: STATUS_COLORS.completed },
  ];
  let acc = 0;
  const stops = segs.map((s) => {
    const start = (acc / total) * 100;
    acc += s.value;
    const end = (acc / total) * 100;
    return `${s.color} ${start}% ${end}%`;
  }).join(', ');
  return (
    <div className="flex items-center gap-6">
      <div className="relative size-40 shrink-0 rounded-full" style={{ background: `conic-gradient(${stops})` }}>
        <div className="absolute inset-6 flex items-center justify-center rounded-full bg-card text-2xl font-bold text-foreground">
          {status.total}
        </div>
      </div>
      <div className="space-y-1.5">
        {segs.map((s) => (
          <div key={s.key} className="flex items-center gap-2 text-sm">
            <span className="size-3 rounded-sm" style={{ background: s.color }} />
            <span className="text-foreground">{s.label}</span>
            <span className="text-muted-foreground">— {s.value} ({Math.round((s.value / total) * 100)}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BarRow({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-20 shrink-0 text-right text-muted-foreground">{label}</span>
      <div className="flex-1">
        <div className="h-5 rounded" style={{ width: `${max ? (value / max) * 100 : 0}%`, minWidth: value ? 24 : 0, background: color }} />
      </div>
      <span className="w-6 text-foreground">{value}</span>
    </div>
  );
}

export default function ProjectAnalyticsPage() {
  const { data, isLoading } = useQuery<Analytics>({
    queryKey: ['projects', 'analytics'],
    queryFn: async () => (await api.get('/api/projects/analytics')).data,
  });

  if (isLoading || !data) return <p className="text-muted-foreground">Loading...</p>;

  const maxPriority = Math.max(1, ...PRIORITY_ORDER.map((p) => data.byPriority[p] ?? 0));
  const maxWorkload = Math.max(1, ...data.userWorkload.map((u) => u.count));

  return (
    <div>
      <Link to="/projects" className="mb-3 -ml-1 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> All projects
      </Link>
      <h1 className="mb-6 text-2xl font-bold text-foreground">Project health</h1>

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card><CardContent className="py-4"><div className="text-xl font-bold text-foreground">{money(data.portfolio.revenue)}</div><div className="text-xs text-muted-foreground">Portfolio revenue</div></CardContent></Card>
        <Card><CardContent className="py-4"><div className="text-xl font-bold text-foreground">{money(data.portfolio.cost)}</div><div className="text-xs text-muted-foreground">Portfolio cost</div></CardContent></Card>
        <Card><CardContent className="py-4"><div className={`text-xl font-bold ${data.portfolio.grossProfit >= 0 ? 'text-success' : 'text-destructive'}`}>{money(data.portfolio.grossProfit)}</div><div className="text-xs text-muted-foreground">Gross profit</div></CardContent></Card>
        <Card><CardContent className="py-4"><div className={`text-xl font-bold ${data.portfolio.margin >= 0 ? 'text-success' : 'text-destructive'}`}>{data.portfolio.margin}%</div><div className="text-xs text-muted-foreground">Gross margin</div></CardContent></Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-sm">Task status</CardTitle></CardHeader>
          <CardContent className="pb-6"><Donut status={data.taskStatus} /></CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Tasks by priority</CardTitle></CardHeader>
          <CardContent className="space-y-2 pb-6">
            {PRIORITY_ORDER.map((p) => (
              <BarRow key={p} label={PRIORITY_LABEL[p]} value={data.byPriority[p] ?? 0} max={maxPriority} color="#f59e0b" />
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">User workload (unresolved tasks)</CardTitle></CardHeader>
          <CardContent className="space-y-2 pb-6">
            {data.userWorkload.length === 0 && <p className="text-sm text-muted-foreground">No assigned open tasks.</p>}
            {data.userWorkload.map((u) => (
              <BarRow key={u.name} label={u.name} value={u.count} max={maxWorkload} color="#10b981" />
            ))}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-sm">Per-project rollup &amp; RAG health</CardTitle></CardHeader>
          <CardContent className="pb-4">
            <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="w-px border-r"><HeadLabel icon={HeartPulse}>Health</HeadLabel></TableHead>
                  <TableHead className="border-r"><HeadLabel icon={FolderKanban}>Project</HeadLabel></TableHead>
                  <TableHead className="border-r"><HeadLabel icon={TrendingUp} className="justify-end">Progress</HeadLabel></TableHead>
                  <TableHead className="border-r"><HeadLabel icon={AlertTriangle} className="justify-end">Overdue</HeadLabel></TableHead>
                  <TableHead className="border-r"><HeadLabel icon={ListChecks} className="justify-end">Tasks</HeadLabel></TableHead>
                  <TableHead className="border-r"><HeadLabel icon={Banknote} className="justify-end">Revenue</HeadLabel></TableHead>
                  <TableHead className="border-r"><HeadLabel icon={Wallet} className="justify-end">Cost</HeadLabel></TableHead>
                  <TableHead><HeadLabel icon={Percent} className="justify-end">Margin</HeadLabel></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.perProject.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="border-r text-center"><span className={`inline-block size-3 rounded-full ${RAG_COLOR[p.rag]}`} title={p.rag} /></TableCell>
                    <TableCell className="border-r font-medium">{p.name}</TableCell>
                    <TableCell className="border-r text-right tabular-nums">{p.progress}%</TableCell>
                    <TableCell className={`border-r text-right tabular-nums ${p.overdue ? 'text-destructive' : ''}`}>{p.overdue}</TableCell>
                    <TableCell className="border-r text-right tabular-nums">{p.completed}/{p.total}</TableCell>
                    <TableCell className="border-r text-right tabular-nums">{money(p.revenue)}</TableCell>
                    <TableCell className="border-r text-right tabular-nums">{money(p.cost)}</TableCell>
                    <TableCell className={`text-right tabular-nums ${p.margin >= 0 ? '' : 'text-destructive'}`}>{p.margin}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
