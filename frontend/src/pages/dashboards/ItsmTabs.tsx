import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, Briefcase, CheckCircle2, ClipboardList, FileStack, GitPullRequestArrow, Gauge, ListChecks, ShieldCheck, Timer, XCircle,
} from 'lucide-react';
import { useDateFormat } from '@/lib/dateFormat';
import { CHANGE_STAGES, type ChangeRequestSummary } from '../change-requests/changeRequestMeta';
import type { ProjectLite } from './itsmData';
import { Delta, Donut, Empty, INK, KpiCard, type KpiTone, LegendDot, MUTED, Panel, PanelLink, Ring } from './itsmParts';

/**
 * The Change Requests and Project Management tabs. The mockups only draw the
 * Tickets tab, so these reuse its vocabulary — the same tiles, panels and
 * palette — over the change and project data.
 */
export interface Palette {
  tones: { blue: KpiTone; green: KpiTone; orange: KpiTone; purple: KpiTone; teal: KpiTone; red: KpiTone };
  valueFirst: boolean;
  link: string;
  barDark: string;
  green: string;
  orange: string;
  red: string;
  track: string;
  priority: { bg: string; fg: string }[]; // critical, high, medium, low
}

const settled = (c: ChangeRequestSummary) => c.stage === 'Close' || ['Completed', 'Deployed', 'Accepted'].includes(c.status ?? '');
const dropped = (c: ChangeRequestSummary) => ['Rejected', 'Cancelled'].includes(c.status ?? '');
const LIST_CAP = 5;

function ShowAllToggle({ total, expanded, onToggle, color }: { total: number; expanded: boolean; onToggle: () => void; color: string }) {
  if (total <= LIST_CAP) return null;
  return (
    <button type="button" onClick={onToggle} className="mt-2 self-start text-xs font-semibold hover:underline" style={{ color }}>
      {expanded ? 'Show less' : `Show all ${total}`}
    </button>
  );
}

export function ChangeRequestsView({ list, pal }: { list: ChangeRequestSummary[]; pal: Palette }) {
  const { fmtDate } = useDateFormat();
  const [expanded, setExpanded] = useState(false);
  const total = list.length;
  const open = list.filter((c) => !settled(c) && !dropped(c));
  const atCab = open.filter((c) => c.stage === 'CAB Evaluation').length;
  const done = list.filter(settled).length;
  const rejected = list.filter(dropped).length;
  const emergency = list.filter((c) => (c.changeType ?? '').toLowerCase() === 'emergency').length;

  const byStage = CHANGE_STAGES.map((s) => ({ stage: s, n: open.filter((c) => (c.stage ?? 'Submission') === s).length }));
  const stageMax = Math.max(1, ...byStage.map((s) => s.n));
  const PRI = ['Critical', 'High', 'Medium', 'Low'];
  const types = [...new Set(list.map((c) => c.changeType || 'Unclassified'))]
    .map((t) => ({ t, n: list.filter((c) => (c.changeType || 'Unclassified') === t).length }))
    .sort((a, b) => b.n - a.n);
  const typeColors = [pal.barDark, pal.green, pal.orange, pal.red, '#8e54df', '#03b49b'];
  const recent = [...list].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  const shown = expanded ? recent : recent.slice(0, LIST_CAP);
  const n = (v: number) => v.toLocaleString('en-US');

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <KpiCard to="/change-requests" icon={<FileStack />} label="Total Changes" value={n(total)} delta={<Delta value={null} />} tone={pal.tones.blue} valueFirst={pal.valueFirst} />
        <KpiCard to="/change-requests" icon={<GitPullRequestArrow />} label="In Progress" value={n(open.length)} delta={<Sub>{atCab} awaiting CAB</Sub>} tone={pal.tones.orange} valueFirst={pal.valueFirst} />
        <KpiCard to="/change-requests" icon={<CheckCircle2 />} label="Completed" value={n(done)} delta={<Sub>{total ? Math.round((done / total) * 100) : 0}% of raised</Sub>} tone={pal.tones.green} valueFirst={pal.valueFirst} />
        <KpiCard to="/change-requests" icon={<AlertTriangle />} label="Emergency" value={n(emergency)} delta={<Sub>CAB exempt</Sub>} tone={pal.tones.purple} valueFirst={pal.valueFirst} />
        <KpiCard to="/change-requests" icon={<XCircle />} label="Rejected / Cancelled" value={n(rejected)} delta={<Sub>this period</Sub>} tone={pal.tones.red} valueFirst={pal.valueFirst} />
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Panel title="Open Changes by Stage" icon={<ListChecks />} action={<PanelLink to="/change-requests" color={pal.link}>View All</PanelLink>}>
          {open.length === 0 ? <Empty>No open changes in this period.</Empty> : (
            <div className="space-y-2.5">
              {byStage.map((s) => (
                <div key={s.stage} className="grid grid-cols-[7.5rem_1fr_2rem] items-center gap-3 text-sm" style={{ color: INK }}>
                  <span className="truncate">{s.stage}</span>
                  <span className="h-3.5 rounded-full bg-[#ebeffb]">
                    <span className="block h-full rounded-full" style={{ width: `${(s.n / stageMax) * 100}%`, background: pal.barDark }} />
                  </span>
                  <span className="text-right font-semibold">{s.n}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Changes by Type" icon={<Gauge />}>
          {total === 0 ? <Empty>No changes raised in this period.</Empty> : (
            <div className="flex flex-1 items-center gap-6">
              <Donut segments={types.map((t, i) => ({ value: t.n, color: typeColors[i % typeColors.length] }))} size={150} stroke={18}>
                <span className="text-2xl font-bold" style={{ color: INK }}>{total}</span>
                <span className="text-xs" style={{ color: MUTED }}>Changes</span>
              </Donut>
              <div className="flex min-w-0 flex-col gap-2.5">
                {types.map((t, i) => (
                  <div key={t.t} className="flex items-center justify-between gap-6">
                    <LegendDot color={typeColors[i % typeColors.length]} label={t.t} />
                    <span className="text-sm font-semibold" style={{ color: INK }}>{t.n}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Panel>

        <Panel title="Changes by Priority" icon={<ClipboardList />}>
          <div className="grid flex-1 grid-cols-4 gap-3">
            {PRI.map((p, i) => (
              <Link key={p} to="/change-requests" className="flex flex-col items-center justify-center rounded-xl py-6" style={{ background: pal.priority[i].bg }}>
                <span className="text-2xl font-bold" style={{ color: INK }}>{list.filter((c) => c.priority === p).length}</span>
                <span className="text-sm font-medium" style={{ color: pal.priority[i].fg }}>{p}</span>
              </Link>
            ))}
          </div>
        </Panel>
      </div>

      <Panel title={`Recent Changes (${total})`} icon={<FileStack />} action={<PanelLink to="/change-requests" color={pal.link}>View All</PanelLink>}>
        {total === 0 ? <Empty>No changes raised in this period.</Empty> : (
          <>
            <div className="overflow-hidden rounded-lg border border-[#e3e8f4]">
              <table className="w-full table-fixed text-sm">
                <thead className="bg-[#f1f4fb] text-left" style={{ color: INK }}>
                  <tr>
                    <th className="w-32 px-3 py-2 font-semibold">CR No.</th>
                    <th className="px-3 py-2 font-semibold">Title</th>
                    <th className="w-44 px-3 py-2 font-semibold">Customer</th>
                    <th className="w-36 px-3 py-2 font-semibold">Stage</th>
                    <th className="w-28 px-3 py-2 font-semibold">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((c) => (
                    <tr key={c.id} className="border-t border-[#eef1f8] hover:bg-[#f7f9fe]">
                      <td className="px-3 py-2"><Link to={`/change-requests/${c.id}`} className="font-medium hover:underline" style={{ color: pal.link }}>{c.crNumber}</Link></td>
                      <td className="truncate px-3 py-2" title={c.title} style={{ color: INK }}>{c.title}</td>
                      <td className="truncate px-3 py-2" title={c.customer ?? ''} style={{ color: INK }}>{c.customer || 'Internal'}</td>
                      <td className="px-3 py-2" style={{ color: INK }}>{c.stage ?? 'Submission'}</td>
                      <td className="px-3 py-2" style={{ color: MUTED }}>{fmtDate(c.crDate ?? c.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ShowAllToggle total={total} expanded={expanded} onToggle={() => setExpanded((v) => !v)} color={pal.link} />
          </>
        )}
      </Panel>
    </div>
  );
}

const Sub = ({ children }: { children: ReactNode }) => <span className="text-xs font-semibold" style={{ color: MUTED }}>{children}</span>;

export function ProjectsView({
  projects, health, targets, pal,
}: {
  projects: ProjectLite[];
  health: { running: number; onTrack: number; atRisk: number; delayed: number; avgProgress: number | null };
  targets: { target: number; achieved: number; prevAchieved: number; runningTasks: { status: string; dueDate: string | null }[] };
  pal: Palette;
}) {
  const { fmtDate } = useDateFormat();
  const [expanded, setExpanded] = useState(false);
  const [now] = useState(() => Date.now());
  const openTasks = targets.runningTasks.filter((t) => t.status !== 'COMPLETED');
  const overdue = openTasks.filter((t) => t.dueDate && new Date(t.dueDate).getTime() < now).length;
  const achievedPct = targets.target ? Math.round((targets.achieved / targets.target) * 100) : null;
  const rank = { RED: 0, AMBER: 1, GREEN: 2 } as const;
  const sorted = [...projects].sort((a, b) => (rank[a.health ?? 'GREEN'] - rank[b.health ?? 'GREEN']) || a.progress - b.progress);
  const shown = expanded ? sorted : sorted.slice(0, LIST_CAP);
  const healthColor = (h: ProjectLite['health']) => (h === 'RED' ? pal.red : h === 'AMBER' ? pal.orange : pal.green);
  const healthLabel = (h: ProjectLite['health']) => (h === 'RED' ? 'Delayed' : h === 'AMBER' ? 'At Risk' : 'On Track');

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <KpiCard to="/projects" icon={<Briefcase />} label="Running Projects" value={String(health.running)} delta={<Sub>active now</Sub>} tone={pal.tones.blue} valueFirst={pal.valueFirst} />
        <KpiCard to="/projects?health=on-track" icon={<ShieldCheck />} label="On Track" value={String(health.onTrack)} delta={<Sub>no overdue tasks</Sub>} tone={pal.tones.green} valueFirst={pal.valueFirst} />
        <KpiCard to="/projects?health=at-risk" icon={<AlertTriangle />} label="At Risk" value={String(health.atRisk)} delta={<Sub>1–2 overdue tasks</Sub>} tone={pal.tones.orange} valueFirst={pal.valueFirst} />
        <KpiCard to="/projects?health=off-track" icon={<Timer />} label="Delayed" value={String(health.delayed)} delta={<Sub>3+ overdue tasks</Sub>} tone={pal.tones.red} valueFirst={pal.valueFirst} />
        <KpiCard to="/projects" icon={<Gauge />} label="Avg. Progress" value={health.avgProgress == null ? '—' : `${health.avgProgress}%`} delta={<Sub>{overdue} tasks overdue</Sub>} tone={pal.tones.teal} valueFirst={pal.valueFirst} />
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Panel title="Tasks Due vs Completed" icon={<ListChecks />}>
          {targets.target === 0 ? <Empty>No project tasks fall due in this period.</Empty> : (
            <div className="flex flex-1 items-center gap-6">
              <Ring pct={achievedPct} color={pal.barDark} track={pal.track} size={150} stroke={18}>
                <span className="text-[26px] font-bold" style={{ color: INK }}>{achievedPct}%</span>
                <span className="text-xs" style={{ color: INK }}>Completed</span>
              </Ring>
              <div className="space-y-2 text-sm" style={{ color: INK }}>
                <div>Due<div className="text-2xl font-bold">{targets.target}</div></div>
                <div>Completed<div className="text-2xl font-bold">{targets.achieved}</div></div>
                <Delta value={targets.prevAchieved ? Math.round(((targets.achieved - targets.prevAchieved) / targets.prevAchieved) * 100) : null} />
              </div>
            </div>
          )}
        </Panel>

        <Panel title="Project Health" icon={<Briefcase />} action={<PanelLink to="/projects" color={pal.link}>View All</PanelLink>}>
          {health.running === 0 ? <Empty>No running projects.</Empty> : (
            <div className="flex flex-1 items-center gap-6">
              <Donut
                segments={[{ value: health.onTrack, color: pal.green }, { value: health.atRisk, color: pal.orange }, { value: health.delayed, color: pal.red }]}
                size={150} stroke={18}
              >
                <span className="text-2xl font-bold" style={{ color: INK }}>{health.running}</span>
                <span className="text-xs" style={{ color: MUTED }}>Projects</span>
              </Donut>
              <div className="flex flex-col gap-3">
                {([['On Track', health.onTrack, pal.green, 'on-track'], ['At Risk', health.atRisk, pal.orange, 'at-risk'], ['Delayed', health.delayed, pal.red, 'off-track']] as const).map(([l, v, c, q]) => (
                  <Link key={l} to={`/projects?health=${q}`} className="flex items-center justify-between gap-8 hover:underline">
                    <LegendDot color={c} label={l} />
                    <span className="text-sm font-semibold" style={{ color: INK }}>{v}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </Panel>

        <Panel title="Open Project Tasks" icon={<ClipboardList />}>
          <div className="grid flex-1 grid-cols-2 gap-3">
            {([
              ['Open', openTasks.length, pal.priority[2]],
              ['Overdue', overdue, pal.priority[0]],
              ['In Review', openTasks.filter((t) => t.status === 'REVIEW').length, pal.priority[1]],
              ['In Progress', openTasks.filter((t) => t.status === 'IN_PROGRESS').length, pal.priority[3]],
            ] as const).map(([l, v, tone]) => (
              <div key={l} className="flex flex-col items-center justify-center rounded-xl py-4" style={{ background: tone.bg }}>
                <span className="text-2xl font-bold" style={{ color: INK }}>{v}</span>
                <span className="text-sm font-medium" style={{ color: tone.fg }}>{l}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <Panel title={`Project Progress (${projects.length})`} icon={<Briefcase />} action={<PanelLink to="/projects" color={pal.link}>View All</PanelLink>}>
        {projects.length === 0 ? <Empty>No running projects.</Empty> : (
          <>
            <div className="space-y-3">
              {shown.map((p) => (
                <Link key={p.id} to={`/projects/${p.id}`} className="grid grid-cols-[minmax(0,14rem)_1fr_3rem_6rem_6rem] items-center gap-4 rounded-lg px-2 py-1 text-sm hover:bg-[#f7f9fe]" style={{ color: INK }}>
                  <span className="truncate font-medium" title={p.name}>{p.name}</span>
                  <span className="h-3 rounded-full bg-[#ebeffb]">
                    <span className="block h-full rounded-full" style={{ width: `${Math.min(100, p.progress ?? 0)}%`, background: healthColor(p.health) }} />
                  </span>
                  <span className="text-right font-semibold">{Math.round(p.progress ?? 0)}%</span>
                  <span className="text-xs font-semibold" style={{ color: healthColor(p.health) }}>{healthLabel(p.health)}</span>
                  <span className="text-xs" style={{ color: MUTED }}>{p.endDate ? fmtDate(p.endDate) : '—'}</span>
                </Link>
              ))}
            </div>
            <ShowAllToggle total={projects.length} expanded={expanded} onToggle={() => setExpanded((v) => !v)} color={pal.link} />
          </>
        )}
      </Panel>
    </div>
  );
}
