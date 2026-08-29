import { useRef, useState } from 'react';
import { Check, CircleDot, Layers, ShieldCheck } from 'lucide-react';
import { CAB_STAGE, CAB_TYPES, CHANGE_STAGES, stageIndex, type ChangeRequest } from '../changeRequestMeta';
import { cn } from '@/lib/utils';

/**
 * A read-only picture of the whole change lifecycle: the fixed CHANGE_STAGES
 * spine, the "is CAB required?" branch and the CAB sign-off node, with the
 * record's own state (current stage, change type, CAB decision) painted on top.
 *
 * Deliberately hand-laid on a fixed canvas — the pipeline is a constant, so the
 * coordinates below are the layout. Nothing here advances a stage; the General
 * tab owns that.
 */

const CARD_W = 220;
const CARD_H = 112;
const CANVAS_W = 1240;
const CANVAS_H = 950;
// Viewport height for the canvas. The canvas itself is taller, so the rest is
// reached by dragging rather than by a scrollbar.
const VIEWPORT_H = '70vh';

// --- pan cursors ----------------------------------------------------------
// The stock `grab` cursor is a pale outline that vanishes against the light
// canvas, so both states are drawn here instead: a dark hand with a white halo,
// which stays legible over the cards, the connectors and either theme's canvas.
//
// Each hand is a composite of rounded rects, painted twice — a white
// filled+stroked copy underneath, the dark copy exactly on top. The white
// showing past the dark edge is the halo, and painting the underlay solid white
// keeps the shapes' internal overlaps from drawing seams.
const HAND = (shapes: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">` +
  `<g fill="#fff" stroke="#fff" stroke-width="3" stroke-linejoin="round">${shapes}</g>` +
  `<g fill="#111827">${shapes}</g></svg>`;

// Open hand: four fingers at staggered heights, an angled thumb, a broad palm.
const GRAB_SHAPES =
  '<rect x="7.2" y="4" width="2.6" height="10" rx="1.3"/>' +
  '<rect x="10.4" y="2.8" width="2.6" height="11.2" rx="1.3"/>' +
  '<rect x="13.6" y="3.6" width="2.6" height="10.4" rx="1.3"/>' +
  '<rect x="16.8" y="5.6" width="2.6" height="8.4" rx="1.3"/>' +
  '<rect x="4.2" y="8" width="2.6" height="7" rx="1.3" transform="rotate(-32 5.5 11.5)"/>' +
  '<rect x="6.4" y="10" width="13.6" height="10" rx="4.5"/>';

// Closed fist: the same palm with the fingers curled down to knuckles.
const GRABBING_SHAPES =
  '<rect x="6.6" y="7" width="2.6" height="4.2" rx="1.3"/>' +
  '<rect x="9.8" y="6.4" width="2.6" height="4.8" rx="1.3"/>' +
  '<rect x="13" y="6.6" width="2.6" height="4.6" rx="1.3"/>' +
  '<rect x="16.2" y="7.4" width="2.6" height="4" rx="1.3"/>' +
  '<rect x="3.6" y="11" width="3.2" height="5.6" rx="1.6" transform="rotate(-18 5.2 13.8)"/>' +
  '<rect x="5" y="9.5" width="14" height="10.5" rx="4.5"/>';

// Hotspot at the palm's centre, with the native keyword as the fallback for a
// browser that refuses the data URI.
const cursorFor = (shapes: string, fallback: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(HAND(shapes))}") 12 12, ${fallback}`;

const GRAB_CURSOR = cursorFor(GRAB_SHAPES, 'grab');
const GRABBING_CURSOR = cursorFor(GRABBING_SHAPES, 'grabbing');

// Top-left of each stage card. Row 1 is Submission -> Planning -> the branch,
// the CAB column hangs below the diamond, then the spine resumes left-to-right.
const POS: Record<string, { x: number; y: number }> = {
  'Submission': { x: 200, y: 40 },
  'Planning': { x: 480, y: 40 },
  'CAB Evaluation': { x: 760, y: 250 },
  'Implementation': { x: 40, y: 620 },
  'UAT': { x: 320, y: 620 },
  'Release': { x: 600, y: 620 },
  'Review': { x: 880, y: 620 },
  'Close': { x: 880, y: 800 },
};

const CAB_BOARD = { x: 760, y: 420 };
const DIAMOND = { cx: 870, cy: 95, r: 58 };
const START = { x: 40, y: 75, w: 120, h: 40 };

// The sub-statuses a stage can sit in. Labels only — the platform stores one
// `stage` per record, so these describe the stage rather than drive it.
const SUB_STATUSES: Record<string, string[]> = {
  'Submission': ['Requested', 'Accepted', 'Rejected'],
  'Planning': ['Planning in progress', 'Submit for review'],
  'CAB Evaluation': ['Approval pending', 'Approved', 'Rejected'],
  'Implementation': ['In progress', 'Completed', 'Back out'],
  'UAT': ['In testing', 'Passed', 'Failed'],
  'Release': ['Scheduled', 'Released'],
  'Review': ['Under review', 'Signed off'],
  'Close': ['Closed'],
};

type Pt = [number, number];
type EdgeTone = 'spine' | 'on' | 'off';

const STROKE: Record<EdgeTone, { stroke: string; width: number; dash?: string; opacity: number }> = {
  spine: { stroke: 'color-mix(in srgb, var(--foreground) 32%, transparent)', width: 2, opacity: 1 },
  on: { stroke: 'var(--primary)', width: 2.5, opacity: 1 },
  off: { stroke: 'color-mix(in srgb, var(--foreground) 30%, transparent)', width: 2, dash: '5 5', opacity: 0.4 },
};

function Edge({ points, tone }: { points: Pt[]; tone: EdgeTone }) {
  const s = STROKE[tone];
  const end = points[points.length - 1];
  return (
    <g opacity={s.opacity}>
      <polyline
        points={points.map((p) => p.join(',')).join(' ')}
        fill="none"
        stroke={s.stroke}
        strokeWidth={s.width}
        strokeDasharray={s.dash}
        strokeLinejoin="round"
      />
      {/* The dot terminator — it reads as "flows into this node". */}
      <circle cx={end[0]} cy={end[1]} r={3.5} fill={s.stroke} />
    </g>
  );
}

function SubRow({ label, dot }: { label: string; dot: string }) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-[3px] text-[11px] text-foreground/80">
      <span className={'size-1.5 shrink-0 rounded-full ' + dot} />
      <span className="truncate">{label}</span>
    </div>
  );
}

function StageCard({
  stage, x, y, state, dimmed,
}: {
  stage: string;
  x: number;
  y: number;
  state: 'done' | 'current' | 'upcoming';
  dimmed: boolean;
}) {
  return (
    <div
      className="absolute z-10 overflow-hidden rounded-md border bg-card shadow-sm"
      style={{ left: x, top: y, width: CARD_W, height: CARD_H, opacity: dimmed ? 0.45 : 1 }}
    >
      <div
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-semibold text-white"
        style={{ background: state === 'current' ? 'var(--primary)' : 'hsl(168 60% 45%)' }}
      >
        <Layers className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{stage}</span>
        {state === 'done' && <Check className="size-3.5 shrink-0" strokeWidth={3} />}
        {state === 'current' && <CircleDot className="size-3.5 shrink-0" />}
      </div>
      <div className="py-1">
        {(SUB_STATUSES[stage] ?? []).map((s) => (
          <SubRow key={s} label={s} dot={state === 'upcoming' ? 'bg-muted-foreground/35' : 'bg-muted-foreground/60'} />
        ))}
      </div>
      {state === 'current' && (
        <span className="pointer-events-none absolute inset-0 rounded-md ring-2 ring-primary" />
      )}
    </div>
  );
}

export default function WorkflowDiagram({ cr }: { cr: ChangeRequest }) {
  const current = stageIndex(cr.stage);
  // Mirrors the server rule: Major / Minor / Standard need CAB sign-off;
  // Emergency (and an unset type) skips straight to Implementation.
  const cabRequired = CAB_TYPES.includes(cr.changeType ?? '');
  const cab = (cr.cabApprovalStatus ?? '').toUpperCase();

  const cabTone: EdgeTone = cabRequired ? 'on' : 'off';
  const skipTone: EdgeTone = cabRequired ? 'off' : 'on';

  const stageState = (stage: string): 'done' | 'current' | 'upcoming' => {
    const i = CHANGE_STAGES.indexOf(stage as (typeof CHANGE_STAGES)[number]);
    return i < current ? 'done' : i === current ? 'current' : 'upcoming';
  };

  const cabRowTone = (row: 'Approved' | 'Denied') => {
    if (cab === 'APPROVED') return row === 'Approved' ? 'bg-emerald-500' : 'bg-muted-foreground/30';
    if (cab === 'REJECTED') return row === 'Denied' ? 'bg-destructive' : 'bg-muted-foreground/30';
    return 'bg-amber-500/70';
  };

  // --- click-and-drag panning ---------------------------------------------
  // The pan offset is the viewport's own scroll position, so the canvas keeps
  // its fixed coordinates and nothing about the node layout has to move.
  const viewportRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  // Held in a ref, not state: the drag origin changes on every pointermove and
  // must not queue a re-render per frame.
  const origin = useRef<{ x: number; y: number; left: number; top: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return; // left button only — leave right-click alone
    const el = viewportRef.current;
    if (!el) return;
    // Stop the press from starting a text selection across the node labels.
    e.preventDefault();
    origin.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
    // Capture so a fast drag that leaves the canvas keeps panning until release.
    el.setPointerCapture(e.pointerId);
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = viewportRef.current;
    const from = origin.current;
    if (!el || !from) return;
    // Content follows the cursor: drag right, the canvas moves right.
    el.scrollLeft = from.left - (e.clientX - from.x);
    el.scrollTop = from.top - (e.clientY - from.y);
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!origin.current) return;
    origin.current = null;
    setDragging(false);
    const el = viewportRef.current;
    if (el?.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
  };

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      {/* The viewport keeps overflow:hidden — still a scroll container, so
          scrollLeft/scrollTop pan it, but with no scrollbar chrome. */}
      <div
        ref={viewportRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className={cn('overflow-hidden', dragging && 'select-none')}
        // `cursor` inherits, so one declaration here covers the cards and
        // connectors inside the canvas too.
        style={{ height: VIEWPORT_H, touchAction: 'none', cursor: dragging ? GRABBING_CURSOR : GRAB_CURSOR }}
      >
        <div
          className="relative"
          style={{
            width: CANVAS_W,
            height: CANVAS_H,
            backgroundImage: 'radial-gradient(circle, var(--border) 1px, transparent 1px)',
            backgroundSize: '22px 22px',
          }}
        >
          <svg className="absolute inset-0" width={CANVAS_W} height={CANVAS_H}>
            {/* row 1 spine */}
            <Edge points={[[160, 95], [200, 95]]} tone="spine" />
            <Edge points={[[420, 95], [480, 95]]} tone="spine" />
            <Edge points={[[700, 95], [812, 95]]} tone="spine" />
            {/* Yes — the CAB branch */}
            <Edge points={[[870, 153], [870, 250]]} tone={cabTone} />
            <Edge points={[[870, 362], [870, 420]]} tone={cabTone} />
            <Edge points={[[870, 532], [870, 584], [190, 584], [190, 620]]} tone={cabTone} />
            {/* No — Emergency skips CAB entirely */}
            <Edge points={[[928, 95], [1190, 95], [1190, 556], [110, 556], [110, 620]]} tone={skipTone} />
            {/* row 3 spine */}
            <Edge points={[[260, 676], [320, 676]]} tone="spine" />
            <Edge points={[[540, 676], [600, 676]]} tone="spine" />
            <Edge points={[[820, 676], [880, 676]]} tone="spine" />
            <Edge points={[[990, 732], [990, 800]]} tone="spine" />
          </svg>

          {/* Start */}
          <div
            className="absolute z-10 flex items-center gap-2 rounded-full border bg-card px-3 text-sm font-medium shadow-sm"
            style={{ left: START.x, top: START.y, width: START.w, height: START.h }}
          >
            <span className="size-2.5 rounded-full bg-emerald-500" />
            Start
          </div>

          {/* Stage cards */}
          {CHANGE_STAGES.map((stage) => (
            <StageCard
              key={stage}
              stage={stage}
              x={POS[stage].x}
              y={POS[stage].y}
              state={stageState(stage)}
              dimmed={stage === CAB_STAGE && !cabRequired}
            />
          ))}

          {/* Condition diamond */}
          <div
            className="absolute z-10 flex items-center justify-center"
            style={{ left: DIAMOND.cx - DIAMOND.r, top: DIAMOND.cy - DIAMOND.r, width: DIAMOND.r * 2, height: DIAMOND.r * 2 }}
          >
            <span
              className="absolute inset-0 shadow-sm"
              style={{ background: 'hsl(214 84% 56%)', clipPath: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)' }}
            />
            <span className="relative px-3 text-center text-[11px] font-semibold leading-tight text-white">CAB required?</span>
          </div>

          {/* Branch labels */}
          <span
            className="absolute z-10 rounded-full border bg-card px-2 py-0.5 text-[10px] font-medium shadow-sm"
            style={{ left: 884, top: 170 }}
          >
            Yes · {CAB_TYPES.join(' / ')}
          </span>
          <span
            className="absolute z-10 rounded-full border bg-card px-2 py-0.5 text-[10px] font-medium shadow-sm"
            style={{ left: 960, top: 62 }}
          >
            No · Emergency
          </span>

          {/* CAB sign-off node */}
          <div
            className="absolute z-10 overflow-hidden rounded-md border bg-card shadow-sm"
            style={{ left: CAB_BOARD.x, top: CAB_BOARD.y, width: CARD_W, height: CARD_H, opacity: cabRequired ? 1 : 0.45 }}
          >
            <div className="flex items-center gap-1.5 bg-emerald-600 px-2.5 py-1.5 text-[12px] font-semibold text-white">
              <ShieldCheck className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">CAB Board</span>
            </div>
            <div className="py-1">
              <SubRow label="Approved" dot={cabRowTone('Approved')} />
              <SubRow label="Denied" dot={cabRowTone('Denied')} />
              <div className="px-2.5 pt-0.5 text-[10px] text-muted-foreground">
                {cab === 'APPROVED'
                  ? 'Approved'
                  : cab === 'REJECTED'
                    ? 'Rejected'
                    : cabRequired
                      ? 'Awaiting decision'
                      : 'Not required'}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 border-t px-3 py-2 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5"><Check className="size-3" strokeWidth={3} /> Completed</span>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full ring-2 ring-primary" /> Current stage</span>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-muted-foreground/35" /> Upcoming</span>
        <span className="ml-auto">Read-only — advance the change from the General tab.</span>
      </div>
    </div>
  );
}
