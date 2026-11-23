import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowLeftRight, BarChart3, Briefcase, Check, CheckCircle2, Clock, Hourglass, Lightbulb, List, Smile, Tag, Target,
  Ticket, TriangleAlert, Users, ShieldCheck, ChartLine,
} from 'lucide-react';
import { useDateFormat } from '@/lib/dateFormat';
import { buildInsights, OPEN, RANGE_KEYS, rangeFor, SETTLED, SLA_TARGET, ticketsLink, useItsmData, type RangeKey } from './itsmData';
import {
  DashTabs, Delta, Dropdown, Empty, GroupedBars, INK, KpiCard, KpiSkeletonRow, LegendDot, LineChart,
  Panel, PanelLink, RangeIcon, Ring, Skeleton,
} from './itsmParts';
import { ChangeRequestsView, ProjectsView, type Palette } from './ItsmTabs';

/*
 * ITSM Dashboard 1 — built to the client's "Ticketing Dashboard1" mockup.
 * Colours are sampled from that image; keep them as they are (client's request).
 */
const C = {
  page: '#f4f6fe',
  tabOn: '#1763e9',
  tabOff: '#e4e8f3',
  link: '#1763e9',
  created: '#53a6fd',
  resolved: '#003f99',
  line: '#1866f6',
  donut: '#1669f9',
  donutTrack: '#dbdbdb',
  ring: '#01ab61',
  ongoing: '#003d99',
  onTrack: '#02b04e',
  atRisk: '#fe8703',
  delayed: '#eb322f',
  issueBar: '#0648a8',
  issueTrack: '#ebeffb',
  up: '#0cac5d',
  down: '#eb4542',
  downPurple: '#a832a6',
  check: '#00a836',
  wave: '#89b7fe',
};
const TONES = {
  blue: { bg: '#e6edfe', border: '#d6e1fb', icon: '#ffffff', iconBg: '#3c60cc' },
  green: { bg: '#e5f6f3', border: '#d0eee7', icon: '#ffffff', iconBg: '#01a75e' },
  orange: { bg: '#fcefec', border: '#f6e0d9', icon: '#ffffff', iconBg: '#fea33a' },
  purple: { bg: '#eff0fe', border: '#e0e2fb', icon: '#8e54df' },
  teal: { bg: '#e4f8f9', border: '#cdeef0', icon: '#ffffff', iconBg: '#03b49b' },
  red: { bg: '#fee8e8', border: '#f9d4d4', icon: '#ffffff', iconBg: '#f65448' },
};
const PRIORITY_TILES = [
  { key: 'critical', label: 'Critical', bg: '#fec1be', fg: '#c62828' },
  { key: 'high', label: 'High', bg: '#fecfa0', fg: '#a24512' },
  { key: 'medium', label: 'Medium', bg: '#aed3fd', fg: '#1e4fa8' },
  { key: 'low', label: 'Low', bg: '#b8f3c6', fg: '#0d821c' },
] as const;
const PAL: Palette = {
  tones: TONES, valueFirst: false, link: C.link, barDark: C.ongoing, green: C.onTrack, orange: C.atRisk, red: C.delayed,
  track: C.donutTrack, priority: PRIORITY_TILES.map((p) => ({ bg: p.bg, fg: p.fg })),
};

type TabKey = 'tickets' | 'changes' | 'projects';
const TABS = [
  { key: 'tickets' as const, label: 'Tickets', icon: <Ticket /> },
  { key: 'changes' as const, label: 'Change Requests', icon: <ArrowLeftRight /> },
  { key: 'projects' as const, label: 'Project Management', icon: <Briefcase /> },
];

const fmtHours = (h: number | null) => (h == null ? '—' : h >= 48 ? `${(h / 24).toFixed(1)} days` : `${h.toFixed(1)} hrs`);
const n = (v: number) => v.toLocaleString('en-US');

export default function ItsmDashboardOne() {
  const { fmtDate } = useDateFormat();
  const [params, setParams] = useSearchParams();
  const tab = (['tickets', 'changes', 'projects'].includes(params.get('tab') ?? '') ? params.get('tab') : 'tickets') as TabKey;
  const [rangeKey, setRangeKey] = useState<RangeKey>('this-month');
  const [department, setDepartment] = useState('all');
  const range = useMemo(() => rangeFor(rangeKey), [rangeKey]);
  const filters = useMemo(() => ({ range, customerId: 'all', department }), [range, department]);
  const d = useItsmData(filters, 4);
  const { kpis } = d;
  const insights = buildInsights(d, { topIssue: true }).slice(0, 5);

  const rangeOptions = RANGE_KEYS.map((r) => {
    const rr = rangeFor(r.value);
    return { value: r.value, label: `${fmtDate(rr.from)} – ${fmtDate(rr.to)}` };
  });
  const deptOptions = [{ value: 'all', label: 'All Departments' }, ...d.departments.map((x) => ({ value: x, label: x.charAt(0).toUpperCase() + x.slice(1) }))];

  const slaVals = d.months.map((m) => m.sla);
  const slaMin = Math.min(80, ...slaVals.filter((v): v is number => v != null).map((v) => Math.floor(v / 10) * 10));
  const topAgents = d.agents.slice(0, 5);
  const projTarget = d.taskTargets.target;
  const projAch = d.taskTargets.achieved;
  const projPct = projTarget ? Math.round((projAch / projTarget) * 100) : null;
  const team = d.team;
  const teamPct = team.assigned ? Math.round((team.resolved / team.assigned) * 100) : null;
  const teamDelta = d.prevTeam.resolved ? Math.round(((team.resolved - d.prevTeam.resolved) / d.prevTeam.resolved) * 100) : null;
  const projBars = [
    { label: 'Ongoing', v: d.health.running, color: C.ongoing, q: '' },
    { label: 'On Track', v: d.health.onTrack, color: C.onTrack, q: '?health=on-track' },
    { label: 'At Risk', v: d.health.atRisk, color: C.atRisk, q: '?health=at-risk' },
    { label: 'Delayed', v: d.health.delayed, color: C.delayed, q: '?health=off-track' },
  ];
  const projMax = Math.max(1, ...projBars.map((b) => b.v));

  return (
    <div className="-m-8 min-h-[calc(100svh-3.5rem)] p-8" style={{ background: C.page }}>
      <div className="mx-auto max-w-[1600px] space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-bold tracking-tight" style={{ color: '#000c4e' }}>IT Service Management Dashboard</h1>
            <p className="mt-1 text-base" style={{ color: '#2a3460' }}>Monitor performance across Tickets, Changes and Projects</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Dropdown value={rangeKey} options={rangeOptions} onChange={setRangeKey} icon={<RangeIcon />} className="min-w-[17rem]" />
            <Dropdown value={department} options={deptOptions} onChange={setDepartment} className="min-w-[11rem]" />
          </div>
        </div>

        <div className="border-b border-[#dde3f1]">
          <DashTabs tabs={TABS} value={tab} onChange={(k) => setParams((p) => { p.set('tab', k); return p; }, { replace: true })} active={C.tabOn} inactive={C.tabOff} />
        </div>

        {d.isLoading ? <LoadingBody /> : tab === 'changes' ? (
          <ChangeRequestsView list={d.crList} pal={PAL} />
        ) : tab === 'projects' ? (
          <ProjectsView projects={d.projects} health={d.health} targets={d.taskTargets} pal={PAL} />
        ) : (
          <>
            {/* KPIs */}
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
              <KpiCard to={ticketsLink(range)} icon={<List />} label="Total Tickets" value={n(kpis.total)} delta={<Delta value={kpis.totalDelta} />} tone={TONES.blue} />
              <KpiCard to={ticketsLink(range, { status: SETTLED })} icon={<Check strokeWidth={3} />} label="Resolved" value={n(kpis.resolved)} delta={<Delta value={kpis.resolvedDelta} />} tone={TONES.green} />
              <KpiCard to={ticketsLink(range, { status: OPEN })} icon={<Clock strokeWidth={2.5} />} label="Open Tickets" value={n(kpis.open)} delta={<Delta value={kpis.openDelta} />} tone={TONES.orange} />
              <KpiCard to={ticketsLink(range, { status: SETTLED })} icon={<Hourglass strokeWidth={2.5} />} label="Avg. Resolution Time" value={fmtHours(kpis.avgHours)} delta={<Delta value={kpis.avgDelta} downColor={C.downPurple} />} tone={TONES.purple} />
              <KpiCard to={ticketsLink(range, { status: SETTLED })} icon={<Smile strokeWidth={2.5} />} label="SLA Compliance" value={kpis.sla == null ? '—' : `${kpis.sla}%`} delta={<Delta value={kpis.slaDelta} unit=" pts" />} tone={TONES.teal} />
            </div>

            {/* Row 1 */}
            <div className="grid gap-5 xl:grid-cols-[1.12fr_1fr_1.05fr]">
              <Panel title="Support Agent Performance" icon={<Users />} action={<PanelLink to={ticketsLink(range)} color={C.link}>View Details</PanelLink>}>
                {topAgents.length === 0 ? <Empty>No assigned tickets in this period.</Empty> : (
                  <>
                    <div className="mb-1 flex justify-end gap-5"><LegendDot square color={C.created} label="Created" /><LegendDot square color={C.resolved} label="Resolved" /></div>
                    <GroupedBars groups={topAgents.map((a) => ({ label: a.name, values: [a.assigned, a.resolved] }))} colors={[C.created, C.resolved]} />
                  </>
                )}
              </Panel>

              <Panel title="SLA Trend" icon={<ChartLine />}>
                <div className="mb-1 flex justify-end gap-5"><LegendDot dashed color="#b9c0d0" label="SLA Target" /><LegendDot dashed={false} color={C.line} label="Achieved" /></div>
                {slaVals.every((v) => v == null) ? <Empty>No resolved tickets with an SLA in these months.</Empty> : (
                  <LineChart
                    labels={d.months.map((m) => m.label)}
                    min={slaMin} max={100} ticks={[slaMin, (slaMin + 100) / 2, 100]} suffix="%"
                    series={[
                      { name: 'Target', values: d.months.map(() => SLA_TARGET), color: '#b9c0d0', dashed: true },
                      { name: 'Achieved', values: slaVals, color: C.line, pointLabels: true },
                    ]}
                  />
                )}
              </Panel>

              <AmcPanel amc={d.amc} fmtDate={fmtDate} />
            </div>

            {/* Row 2 */}
            <div className="grid gap-5 xl:grid-cols-[1.12fr_1fr_1.05fr]">
              <Panel title="Monthly Targets vs Achieved (Projects)" icon={<Target />} action={<PanelLink to="/projects" color={C.link}>View Details</PanelLink>}>
                {projTarget === 0 ? <Empty>No project tasks fall due in this period.</Empty> : (
                  <div className="flex flex-1 items-center gap-6">
                    <Ring pct={projPct} color={C.donut} track={C.donutTrack} size={150} stroke={18}>
                      <span className="text-[26px] font-bold" style={{ color: INK }}>{projPct}%</span>
                      <span className="text-xs" style={{ color: INK }}>Achievement</span>
                    </Ring>
                    <div className="flex flex-col gap-3">
                      <LegendDot square color={C.donut} label="Achieved" />
                      <LegendDot square color={C.donutTrack} label="Remaining" />
                    </div>
                    <div className="ml-auto space-y-1.5 border-l border-[#e3e8f4] pl-5 text-sm" style={{ color: INK }}>
                      <div>Target<div className="text-xl font-bold">{projTarget}</div></div>
                      <div>Achieved<div className="text-xl font-bold">{projAch}</div></div>
                      <div>Variance<div className="text-lg font-bold" style={{ color: projAch - d.taskTargets.prevAchieved >= 0 ? C.up : C.down }}>
                        {projAch - d.taskTargets.prevAchieved >= 0 ? '+' : ''}{projAch - d.taskTargets.prevAchieved}
                      </div></div>
                    </div>
                  </div>
                )}
              </Panel>

              <Panel title="Project Performance" icon={<Briefcase />} action={<PanelLink to="/projects" color={C.link}>View All</PanelLink>}>
                <div className="flex flex-1 flex-col justify-center gap-4">
                  {projBars.map((b) => (
                    <Link key={b.label} to={`/projects${b.q}`} className="grid grid-cols-[5.5rem_1fr] items-center gap-3 text-sm hover:opacity-90" style={{ color: INK }}>
                      <span>{b.label}</span>
                      <span className="flex items-center gap-3">
                        <span className="h-6 rounded-[3px]" style={{ width: `${Math.max(2, (b.v / projMax) * 82)}%`, background: b.color }} />
                        <span className="font-semibold">{b.v}</span>
                      </span>
                    </Link>
                  ))}
                </div>
              </Panel>

              <Panel title="Supporting Consultant Performance" icon={<Users />}>
                {team.assigned === 0 ? <Empty>No assigned tickets in this period.</Empty> : (
                  <div className="flex flex-1 items-center gap-6">
                    <Ring pct={teamPct} color={C.ring} track="#dbdbdb" size={150} stroke={16}>
                      <span className="text-[26px] font-bold" style={{ color: INK }}>{teamPct}%</span>
                      <span className="text-xs" style={{ color: INK }}>Completion Rate</span>
                    </Ring>
                    <div className="space-y-2 border-l border-[#e3e8f4] pl-6 text-[15px]" style={{ color: INK }}>
                      <div>Target Tickets<div className="text-2xl font-bold">{n(team.assigned)}</div></div>
                      <div>Completed Tickets<div className="text-2xl font-bold">{n(team.resolved)}</div></div>
                      <Delta value={teamDelta} />
                    </div>
                  </div>
                )}
              </Panel>
            </div>

            {/* Row 3 */}
            <div className="grid gap-5 xl:grid-cols-[1fr_1.05fr_1.05fr]">
              <Panel title="Ticket Queue by Priority" icon={<BarChart3 />}>
                <div className="grid flex-1 grid-cols-4 gap-3">
                  {PRIORITY_TILES.map((p) => (
                    <Link key={p.key} to={ticketsLink(null, { priority: p.key, status: OPEN })} className="flex flex-col items-center justify-center rounded-lg py-6 transition-transform hover:-translate-y-0.5" style={{ background: p.bg }}>
                      <span className="text-[26px] font-bold" style={{ color: INK }}>{d.queue.find((q) => q.priority === p.key)?.count ?? 0}</span>
                      <span className="text-sm font-medium" style={{ color: p.fg }}>{p.label}</span>
                    </Link>
                  ))}
                </div>
              </Panel>

              <Panel title="Top IT Issues" icon={<Tag />} iconColor="#6b47d6" action={<PanelLink to={ticketsLink(range)} color={C.link}>View Report</PanelLink>}>
                {d.issues.length === 0 ? <Empty>No tickets in this period.</Empty> : (
                  <ol className="space-y-2">
                    {d.issues.map((it, i) => (
                      <li key={it.name} className="grid grid-cols-[1.25rem_minmax(0,11rem)_1fr_2.5rem] items-center gap-3 text-sm" style={{ color: INK }}>
                        <span>{i + 1}</span>
                        <span className="truncate" title={it.name}>{it.name}</span>
                        <span className="h-2 rounded-full" style={{ background: C.issueTrack }}>
                          <span className="block h-full rounded-full" style={{ width: `${it.pct}%`, background: C.issueBar }} />
                        </span>
                        <span className="text-right">{it.pct}%</span>
                      </li>
                    ))}
                  </ol>
                )}
              </Panel>

              <Panel title="Quick Insights" icon={<Lightbulb />} iconColor="#f6a609" className="relative overflow-hidden">
                <ul className="relative z-10 space-y-2.5">
                  {insights.map((i) => (
                    <li key={i.text} className="flex items-start gap-2.5 text-sm" style={{ color: INK }}>
                      {i.tone === 'warn'
                        ? <TriangleAlert className="mt-px size-[18px] shrink-0" style={{ color: '#fc9c06' }} />
                        : <CheckCircle2 className="mt-px size-[18px] shrink-0 fill-[#00a836] text-white" />}
                      {i.text}
                    </li>
                  ))}
                </ul>
                <Wave />
              </Panel>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function AmcPanel({ amc, fmtDate }: { amc: ReturnType<typeof useItsmData>['amc']; fmtDate: (v: string) => string }) {
  const [expanded, setExpanded] = useState(false);
  const rows = amc.rows.filter((r) => r.daysLeft <= 60);
  const shown = expanded ? rows : rows.slice(0, 5);
  return (
    <Panel title="AMC Contracts – Near Expiry" icon={<ShieldCheck />} action={<PanelLink to="/admin/customer-companies" color={C.link}>View All</PanelLink>}>
      <div className="mb-3 grid grid-cols-2 gap-3">
        <div className="flex items-center gap-3 rounded-xl px-4 py-3" style={{ background: '#fee8e8' }}>
          <TriangleAlert className="size-9 shrink-0 fill-[#f65448] text-white" />
          <div className="leading-tight">
            <div className="text-2xl font-bold" style={{ color: '#c61212' }}>{amc.within30}</div>
            <div className="text-xs" style={{ color: '#c61212' }}>Contracts<br />≤ 30 Days</div>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-xl px-4 py-3" style={{ background: '#feecdd' }}>
          <Clock className="size-9 shrink-0" style={{ color: '#fd9225' }} />
          <div className="leading-tight">
            <div className="text-2xl font-bold" style={{ color: '#fd9225' }}>{amc.within60}</div>
            <div className="text-xs" style={{ color: '#fd9225' }}>Contracts<br />≤ 60 Days</div>
          </div>
        </div>
      </div>
      {rows.length === 0 ? <Empty className="py-4">No AMC contracts expire in the next 60 days.</Empty> : (
        <>
          <div className="overflow-hidden rounded-lg border border-[#e3e8f4]">
            <table className="w-full table-fixed text-[13px]" style={{ color: INK }}>
              <thead className="bg-[#f1f4fb] text-left">
                <tr>
                  <th className="w-[26%] px-2.5 py-1.5 font-semibold">Contract No.</th>
                  <th className="px-2.5 py-1.5 font-semibold">Customer</th>
                  <th className="w-[26%] px-2.5 py-1.5 font-semibold">Expiry Date</th>
                  <th className="w-[18%] px-2.5 py-1.5 text-right font-semibold">Days Left</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} className="border-t border-[#eef1f8] hover:bg-[#f7f9fe]">
                    <td className="truncate px-2.5 py-1.5" title={r.product ?? undefined}>
                      <Link to={`/admin/clients/${r.customerCompanyId}`} className="hover:underline">{r.contractNo || '—'}</Link>
                    </td>
                    <td className="truncate px-2.5 py-1.5" title={r.product ? `${r.customer} · ${r.product}` : r.customer}>{r.customer}</td>
                    <td className="px-2.5 py-1.5">{fmtDate(r.expiryDate)}</td>
                    <td className="px-2.5 py-1.5 text-right font-semibold" style={{ color: r.daysLeft <= 30 ? '#e5242a' : INK }}>{r.daysLeft}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 5 && (
            <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-2 self-start text-xs font-semibold hover:underline" style={{ color: C.link }}>
              {expanded ? 'Show less' : `Show all ${rows.length}`}
            </button>
          )}
        </>
      )}
    </Panel>
  );
}

/** The decorative blue wave in the mockup's bottom-right corner. */
function Wave() {
  return (
    <svg className="pointer-events-none absolute -bottom-2 -right-2 h-28 w-56" viewBox="0 0 220 110" aria-hidden>
      <path d="M220 10 C170 30 150 70 100 90 C70 102 40 106 0 110 L220 110 Z" fill={C.wave} opacity={0.35} />
      <path d="M220 40 C185 55 165 85 125 100 C105 107 85 109 60 110 L220 110 Z" fill={C.wave} opacity={0.55} />
    </svg>
  );
}

function LoadingBody() {
  return (
    <div className="space-y-5">
      <KpiSkeletonRow n={5} />
      {[0, 1, 2].map((r) => (
        <div key={r} className="grid gap-5 xl:grid-cols-3">
          {[0, 1, 2].map((c) => <Skeleton key={c} className={r === 2 ? 'h-44' : 'h-72'} />)}
        </div>
      ))}
    </div>
  );
}

