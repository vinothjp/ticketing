import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowLeftRight, BarChart3, Briefcase, CalendarDays, Check, CheckCircle2, Clock, Headphones, Hourglass, Info, Lightbulb,
  ShieldCheck, Target, Ticket, TriangleAlert, Trophy, User, Users,
} from 'lucide-react';
import { useDateFormat } from '@/lib/dateFormat';
import {
  buildInsights, OPEN, RANGE_KEYS, rangeFor, SETTLED, ticketsLink, useItsmData, type RangeKey,
} from './itsmData';
import {
  DashTabs, Delta, Donut, Dropdown, Empty, GroupedBars, INK, KpiCard, KpiSkeletonRow, LegendDot, LineChart, MUTED,
  Panel, PanelLink, RangeIcon, Ring, Skeleton,
} from './itsmParts';
import { ChangeRequestsView, ProjectsView, type Palette } from './ItsmTabs';

/*
 * ITSM Dashboard 2 — built to the client's "Ticketing Dashboard2" mockup.
 * Colours are sampled from that image; keep them as they are (client's request).
 */
const C = {
  page: '#ecf0fd',
  tabOn: '#045bdb',
  tabOff: '#d9e1fb',
  link: '#045bdb',
  barTarget: '#76b9fe',
  barAch: '#044fa8',
  created: '#0a65f3',
  resolved: '#0aa363',
  backlog: '#fb8c06',
  ring: '#06af65',
  ringTrack: '#dcdfe6',
  green: '#06a66d',
  orange: '#fe9e08',
  red: '#d20f15',
  pillText: '#304e96',
  pillBg: '#eef2fb',
  check: '#00a836',
  info: '#0660ea',
  warn: '#fc9c06',
};
const TONES = {
  blue: { bg: '#eef5fe', border: '#d7e6fb', icon: '#1266f0' },
  green: { bg: '#ebfaf9', border: '#cdeeea', icon: '#ffffff', iconBg: '#01a75e' },
  orange: { bg: '#fef7f6', border: '#f8e3dc', icon: '#ffffff', iconBg: '#fea33a' },
  purple: { bg: '#f3f0fd', border: '#e3dcf8', icon: '#8e54df' },
  teal: { bg: '#e9fcfe', border: '#cbeff3', icon: '#03a58f' },
  red: { bg: '#fde8f0', border: '#f8d3df', icon: '#fc3054' },
};
const PAL: Palette = {
  tones: TONES, valueFirst: true, link: C.link, barDark: C.barAch, green: C.green, orange: C.orange, red: C.red, track: C.ringTrack,
  priority: [
    { bg: '#fec1be', fg: '#c62828' }, { bg: '#fecfa0', fg: '#a24512' }, { bg: '#aed3fd', fg: '#1e4fa8' }, { bg: '#b8f3c6', fg: '#0d821c' },
  ],
};

type TabKey = 'tickets' | 'changes' | 'projects';
const TABS = [
  { key: 'tickets' as const, label: 'Tickets', icon: <Headphones /> },
  { key: 'changes' as const, label: 'Change Requests', icon: <ArrowLeftRight /> },
  { key: 'projects' as const, label: 'Project Management', icon: <Briefcase /> },
];
const TREND_OPTIONS = [
  { value: '3', label: 'Last 3 Months' },
  { value: '6', label: 'Last 6 Months' },
  { value: '12', label: 'Last 12 Months' },
];

const fmtHours = (h: number | null) => (h == null ? '—' : h >= 48 ? `${(h / 24).toFixed(1)} days` : `${h.toFixed(1)} hrs`);
const n = (v: number) => v.toLocaleString('en-US');

export default function ItsmDashboardTwo() {
  const { fmtDate } = useDateFormat();
  const [params, setParams] = useSearchParams();
  const tab = (['tickets', 'changes', 'projects'].includes(params.get('tab') ?? '') ? params.get('tab') : 'tickets') as TabKey;
  const [rangeKey, setRangeKey] = useState<RangeKey>('this-month');
  const [customerId, setCustomerId] = useState('all');
  const [department, setDepartment] = useState('all');
  const [trend, setTrend] = useState('6');
  const range = useMemo(() => rangeFor(rangeKey), [rangeKey]);
  const filters = useMemo(() => ({ range, customerId, department }), [range, customerId, department]);
  const d = useItsmData(filters, Number(trend));
  const { kpis } = d;
  const insights = buildInsights(d).slice(0, 4);

  const rangeOptions = RANGE_KEYS.map((r) => {
    const rr = rangeFor(r.value);
    return { value: r.value, label: `${fmtDate(rr.from)} – ${fmtDate(rr.to)}` };
  });
  const rangeName = RANGE_KEYS.find((r) => r.value === rangeKey)?.label ?? '';
  const customerOptions = [{ value: 'all', label: 'All Customers' }, ...d.companies.map((c) => ({ value: c.id, label: c.name }))];
  const deptOptions = [{ value: 'all', label: 'All Departments' }, ...d.departments.map((x) => ({ value: x, label: x.charAt(0).toUpperCase() + x.slice(1) }))];

  const team = d.team;
  const teamPct = team.assigned ? Math.round((team.resolved / team.assigned) * 100) : null;
  const top = d.ranked[0]?.resolved ? d.ranked[0] : undefined;
  const monthBars = d.months.slice(-4);
  const trendHasData = d.months.some((m) => m.created || m.resolved || m.backlog);

  return (
    <div className="-m-8 min-h-[calc(100svh-3.5rem)] p-8" style={{ background: `linear-gradient(180deg, #e3eafc 0%, ${C.page} 220px)` }}>
      <div className="mx-auto max-w-[1600px] space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-[30px] font-bold tracking-tight" style={{ color: '#000c4e' }}>IT Service Management Dashboard</h1>
            <p className="mt-1 text-base" style={{ color: '#1e2f6b' }}>Monitor performance across Tickets, Changes and Projects</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Dropdown value={rangeKey} options={rangeOptions} onChange={setRangeKey} icon={<RangeIcon />} className="min-w-[16rem]" />
            <Dropdown value={customerId} options={customerOptions} onChange={setCustomerId} className="min-w-[10rem]" />
            <Dropdown value={department} options={deptOptions} onChange={setDepartment} className="min-w-[10rem]" />
          </div>
        </div>

        <DashTabs tabs={TABS} value={tab} onChange={(k) => setParams((p) => { p.set('tab', k); return p; }, { replace: true })} active={C.tabOn} inactive={C.tabOff} />

        {d.isLoading ? <LoadingBody /> : tab === 'changes' ? (
          <ChangeRequestsView list={d.crList} pal={PAL} />
        ) : tab === 'projects' ? (
          <ProjectsView projects={d.projects} health={d.health} targets={d.taskTargets} pal={PAL} />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
              <KpiCard valueFirst to={ticketsLink(range)} icon={<Ticket />} label="Total Tickets" value={n(kpis.total)} delta={<Delta value={kpis.totalDelta} />} tone={TONES.blue} />
              <KpiCard valueFirst to={ticketsLink(range, { status: SETTLED })} icon={<Check strokeWidth={3} />} label="Resolved" value={n(kpis.resolved)} delta={<Delta value={kpis.resolvedDelta} />} tone={TONES.green} />
              <KpiCard valueFirst to={ticketsLink(range, { status: OPEN })} icon={<Clock strokeWidth={2.5} />} label="Open Tickets" value={n(kpis.open)} delta={<Delta value={kpis.openDelta} />} tone={TONES.orange} />
              <KpiCard valueFirst to={ticketsLink(range, { status: SETTLED })} icon={<Hourglass strokeWidth={2.5} />} label="Avg. Resolution" value={fmtHours(kpis.avgHours)} delta={<Delta value={kpis.avgDelta} downColor="#a832a6" />} tone={TONES.purple} />
              <KpiCard valueFirst to={ticketsLink(range, { status: SETTLED })} icon={<ShieldCheck strokeWidth={2.2} />} label="SLA Compliance" value={kpis.sla == null ? '—' : `${kpis.sla}%`} delta={<Delta value={kpis.slaDelta} unit=" pts" />} tone={TONES.teal} />
              <KpiCard valueFirst to={ticketsLink(range, { view: 'overdue' })} icon={<TriangleAlert className="fill-[#fc3054] text-white" />} label="Exceptions" value={n(kpis.exceptions)} delta={<Delta value={kpis.exceptionsDelta} upColor="#eb4542" downColor="#0cac5d" />} tone={TONES.red} />
            </div>

            {/* Row 1 */}
            <div className="grid gap-5 xl:grid-cols-[1.05fr_1.15fr_1.1fr]">
              <Panel title="Agent Performance" icon={<Users />} action={<PanelLink to={ticketsLink(range)} color={C.link}>View Details</PanelLink>}>
                {team.assigned === 0 ? <Empty>No assigned tickets in this period.</Empty> : (
                  <>
                    <div className="flex items-center gap-5">
                      <Ring pct={teamPct} color={C.ring} track={C.ringTrack} size={150} stroke={16}>
                        <span className="text-[28px] font-bold" style={{ color: INK }}>{teamPct}%</span>
                        <span className="text-xs leading-tight" style={{ color: INK }}>Target<br />Achieved</span>
                      </Ring>
                      <div className="min-w-0 flex-1 space-y-3 border-l border-[#e3e8f4] pl-4 text-[13px]" style={{ color: INK }}>
                        {top && (
                          <div className="flex items-start gap-2">
                            <Trophy className="mt-0.5 size-4 shrink-0" style={{ color: '#f2a20c' }} />
                            <div className="min-w-0 flex-1">Top Performer<div className="truncate text-[15px] font-bold">{top.name}</div></div>
                            <span className="text-[15px] font-bold">{Math.round((top.resolved / top.assigned) * 100)}%</span>
                          </div>
                        )}
                        <div className="flex items-start gap-2">
                          <User className="mt-0.5 size-4 shrink-0" style={{ color: MUTED }} />
                          <div className="flex-1">Overall Target</div>
                          <span className="text-[15px] font-bold">{n(team.assigned)}</span>
                        </div>
                        <div className="flex items-start gap-2">
                          <Users className="mt-0.5 size-4 shrink-0" style={{ color: '#4a78d6' }} />
                          <div className="flex-1">Achieved</div>
                          <span className="text-[15px] font-bold">{n(team.resolved)}</span>
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 flex justify-center gap-4"><LegendDot square color={C.barTarget} label="Resolved %" /><LegendDot square color={C.barAch} label="SLA Met %" /></div>
                    <GroupedBars
                      pctAxis max={100} height={150} labelSize={10}
                      groups={monthBars.map((m) => ({ label: m.label, values: [m.resolvedPct ?? 0, m.sla ?? 0] }))}
                      colors={[C.barTarget, C.barAch]}
                    />
                  </>
                )}
              </Panel>

              <Panel
                title="Ticket Trend" icon={<BarChart3 />}
                action={<Dropdown value={trend} options={TREND_OPTIONS} onChange={setTrend} className="h-8 border-0 px-2 text-xs font-semibold shadow-none" />}
              >
                <div className="mb-1 flex justify-center gap-5">
                  <LegendDot color={C.created} label="Created" /><LegendDot color={C.resolved} label="Resolved" /><LegendDot color={C.backlog} label="Backlog" />
                </div>
                {!trendHasData ? <Empty>No tickets in these months.</Empty> : (
                  <LineChart
                    labels={d.months.map((m) => m.label)} height={250}
                    series={[
                      { name: 'Created', values: d.months.map((m) => m.created), color: C.created, endLabel: true, area: true },
                      { name: 'Resolved', values: d.months.map((m) => m.resolved), color: C.resolved, endLabel: true, area: true },
                      { name: 'Backlog', values: d.months.map((m) => m.backlog), color: C.backlog, endLabel: true, area: true },
                    ]}
                  />
                )}
              </Panel>

              <AmcPanel amc={d.amc} fmtDate={fmtDate} />
            </div>

            {/* Row 2 */}
            <div className="grid gap-5 xl:grid-cols-[1fr_1.6fr_1.05fr]">
              <Panel title="Project Performance" icon={<Briefcase />} action={<PanelLink to="/projects" color={C.link}>View Projects</PanelLink>}>
                {d.health.running === 0 ? <Empty>No running projects.</Empty> : (
                  <>
                    <div className="flex items-center gap-6">
                      <Donut
                        size={140} stroke={16} track={C.ringTrack}
                        segments={[{ value: d.health.onTrack, color: C.green }, { value: d.health.atRisk, color: C.orange }, { value: d.health.delayed, color: C.red }]}
                      >
                        <span className="text-[26px] font-bold" style={{ color: INK }}>{d.health.avgProgress ?? 0}%</span>
                        <span className="text-xs leading-tight" style={{ color: INK }}>Overall<br />Progress</span>
                      </Donut>
                      <div className="flex flex-1 flex-col gap-3">
                        {([['On Track', d.health.onTrack, C.green, 'on-track'], ['At Risk', d.health.atRisk, C.orange, 'at-risk'], ['Delayed', d.health.delayed, C.red, 'off-track']] as const).map(([l, v, c, q]) => (
                          <Link key={l} to={`/projects?health=${q}`} className="flex items-center justify-between gap-4 hover:underline">
                            <LegendDot color={c} label={l} />
                            <span className="text-sm font-semibold" style={{ color: INK }}>{v}</span>
                          </Link>
                        ))}
                      </div>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <div className="flex items-center gap-3 rounded-xl px-4 py-3" style={{ background: '#f3f0fd' }}>
                        <Target className="size-8 shrink-0" style={{ color: '#8e54df' }} />
                        <div className="text-[13px]" style={{ color: INK }}>Target Tasks<div className="text-xl font-bold">{d.taskTargets.target}</div></div>
                      </div>
                      <div className="flex items-center gap-3 rounded-xl px-4 py-3" style={{ background: '#ebfaf3' }}>
                        <CheckCircle2 className="size-8 shrink-0 fill-[#06a66d] text-white" />
                        <div className="text-[13px]" style={{ color: INK }}>Completed<div className="text-xl font-bold">{d.taskTargets.achieved}</div></div>
                      </div>
                    </div>
                  </>
                )}
              </Panel>

              <ConsultantsPanel ranked={d.ranked} rangeName={rangeName} />

              <Panel title="Key Insights" icon={<Lightbulb />} iconColor="#f6a609">
                <ul className="flex-1 space-y-3">
                  {insights.map((i) => (
                    <li key={i.text} className="flex items-start gap-3 text-sm" style={{ color: INK }}>
                      {i.tone === 'warn' ? <TriangleAlert className="mt-px size-5 shrink-0 fill-[#fc9c06] text-white" />
                        : i.tone === 'info' ? <Info className="mt-px size-5 shrink-0 fill-[#0660ea] text-white" />
                          : <CheckCircle2 className="mt-px size-5 shrink-0 fill-[#00a836] text-white" />}
                      {i.text}
                    </li>
                  ))}
                </ul>
                <Link
                  to={ticketsLink(range)}
                  className="mt-3 flex items-center gap-1.5 self-end rounded-full border px-4 py-1.5 text-xs font-semibold hover:bg-[#f2f6fe]"
                  style={{ color: C.link, borderColor: C.link }}
                >
                  View Detailed Report →
                </Link>
              </Panel>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ConsultantsPanel({ ranked, rangeName }: { ranked: ReturnType<typeof useItsmData>['ranked']; rangeName: string }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? ranked : ranked.slice(0, 4);
  return (
    <Panel
      title="Supporting Consultant Performance" icon={<Users />}
      action={<span className="flex items-center gap-1.5 rounded-lg border border-[#e3e8f4] px-3 py-1 text-xs font-semibold" style={{ color: INK }}><CalendarDays className="size-3.5" />{rangeName}</span>}
    >
      {ranked.length === 0 ? <Empty>No assigned tickets in this period.</Empty> : (
        <>
          <div className="grid flex-1 grid-cols-2 gap-3 lg:grid-cols-4">
            {shown.map((a) => {
              const p = Math.round((a.resolved / a.assigned) * 100);
              return (
                <div key={a.id} className="flex flex-col items-center gap-2 rounded-xl border border-[#e8ecf6] px-2 py-4">
                  <Ring pct={p} color={C.ring} track={C.ringTrack} size={84} stroke={8}>
                    <span className="text-xl font-bold" style={{ color: INK }}>{p}%</span>
                  </Ring>
                  <span className="w-full truncate text-center text-[15px] font-semibold" title={a.name} style={{ color: INK }}>{a.name}</span>
                  <span className="rounded-full px-3 py-1 text-[13px]" style={{ background: C.pillBg, color: C.pillText }}>{a.resolved} / {a.assigned}</span>
                </div>
              );
            })}
          </div>
          {ranked.length > 4 && (
            <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-2 self-start text-xs font-semibold hover:underline" style={{ color: C.link }}>
              {expanded ? 'Show less' : `Show all ${ranked.length}`}
            </button>
          )}
        </>
      )}
    </Panel>
  );
}

function AmcPanel({ amc, fmtDate }: { amc: ReturnType<typeof useItsmData>['amc']; fmtDate: (v: string) => string }) {
  const [expanded, setExpanded] = useState(false);
  const rows = amc.rows.filter((r) => r.daysLeft <= 90);
  const shown = expanded ? rows : rows.slice(0, 3);
  const status = (days: number) =>
    days <= 30 ? { label: '30D', color: '#ffa615' } : days <= 60 ? { label: '60D', color: '#ffa615' } : { label: 'OK', color: '#11984e' };
  return (
    <Panel title="AMC Contract Expiry" icon={<ShieldCheck />} action={<PanelLink to="/admin/customer-companies" color={C.link}>View All</PanelLink>}>
      <div className="mb-3 grid grid-cols-2 gap-3">
        <div className="flex items-center gap-3 rounded-xl px-4 py-3" style={{ background: '#fcefe7' }}>
          <span className="flex size-11 items-center justify-center rounded-full bg-white/70"><CalendarDays className="size-6" style={{ color: '#fe9c0d' }} /></span>
          <div className="leading-tight" style={{ color: '#e1760a' }}>
            <div className="text-2xl font-bold">{amc.within30}</div>
            <div className="text-sm font-semibold">≤ 30 Days</div>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-xl px-4 py-3" style={{ background: '#fde4eb' }}>
          <span className="flex size-11 items-center justify-center rounded-full bg-white/70"><CalendarDays className="size-6" style={{ color: '#f41644' }} /></span>
          <div className="leading-tight" style={{ color: '#d80c2a' }}>
            <div className="text-2xl font-bold">{amc.within60}</div>
            <div className="text-sm font-semibold">≤ 60 Days</div>
          </div>
        </div>
      </div>
      {rows.length === 0 ? <Empty className="py-4">No AMC contracts expire in the next 90 days.</Empty> : (
        <div className="overflow-hidden rounded-lg border border-[#e3e8f4]">
          <table className="w-full table-fixed text-[13px]" style={{ color: INK }}>
            <thead className="bg-[#f1f4fb] text-left">
              <tr>
                <th className="w-[26%] px-2.5 py-1.5 font-semibold">Contract No.</th>
                <th className="px-2.5 py-1.5 font-semibold">Customer</th>
                <th className="w-[26%] px-2.5 py-1.5 font-semibold">Expiry Date</th>
                <th className="w-[17%] px-2.5 py-1.5 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const st = status(r.daysLeft);
                return (
                  <tr key={r.id} className="border-t border-[#eef1f8] hover:bg-[#f7f9fe]">
                    <td className="truncate px-2.5 py-2"><Link to={`/admin/clients/${r.customerCompanyId}`} className="hover:underline">{r.contractNo || '—'}</Link></td>
                    <td className="truncate px-2.5 py-2" title={r.product ? `${r.customer} · ${r.product}` : r.customer}>{r.customer}</td>
                    <td className="px-2.5 py-2">{fmtDate(r.expiryDate)}</td>
                    <td className="px-2.5 py-2 font-semibold" style={{ color: st.color }}>
                      <span className="mr-1">{st.label === 'OK' ? '●' : '◆'}</span>{st.label}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-auto flex items-center justify-between pt-3">
        {rows.length > 3 ? (
          <button type="button" onClick={() => setExpanded((v) => !v)} className="text-xs font-semibold hover:underline" style={{ color: C.link }}>
            {expanded ? 'Show less' : `Show all ${rows.length}`}
          </button>
        ) : <span />}
        <PanelLink to="/admin/customer-companies" color={C.link}>View All Contracts</PanelLink>
      </div>
    </Panel>
  );
}

function LoadingBody() {
  return (
    <div className="space-y-5">
      <KpiSkeletonRow n={6} />
      {[0, 1].map((r) => (
        <div key={r} className="grid gap-5 xl:grid-cols-3">
          {[0, 1, 2].map((c) => <Skeleton key={c} className="h-80" />)}
        </div>
      ))}
    </div>
  );
}
