import { Check, Workflow } from 'lucide-react';
import { CHANGE_STAGES, stageIndex, type ChangeRequest } from '../changeRequestMeta';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import WorkflowDiagram from './WorkflowDiagram';

// Interlocking chevron geometry. Arrow depth = 14px; every segment after the first
// slides left by that depth (negative margin) so the bar stays gapless while each
// chevron keeps a crisp, continuous outline.
const ARROW = 14;
const FIRST = `polygon(0 0, calc(100% - ${ARROW}px) 0, 100% 50%, calc(100% - ${ARROW}px) 100%, 0 100%)`;
const MID = `polygon(0 0, calc(100% - ${ARROW}px) 0, 100% 50%, calc(100% - ${ARROW}px) 100%, 0 100%, ${ARROW}px 50%)`;
const LAST = `polygon(0 0, 100% 0, 100% 100%, 0 100%, ${ARROW}px 50%)`;

// A clip-path removes real borders/box-shadows, so each segment is drawn as two
// stacked chevrons: the button background is the border colour and an inset inner
// layer (same clip) carries the fill — the exposed 1px rim is the crisp border.
type Look = { fill: string; border: string; color: string; rim: number };

function lookFor(done: boolean, current: boolean, open: boolean): Look {
  if (current) {
    return {
      fill: 'var(--primary)',
      border: open ? 'color-mix(in srgb, var(--primary) 78%, #000)' : 'color-mix(in srgb, var(--primary) 88%, #000)',
      color: 'var(--primary-foreground)',
      rim: open ? 1.5 : 1,
    };
  }
  if (done) {
    return {
      fill: 'color-mix(in srgb, var(--primary) 12%, var(--card))',
      border: open ? 'var(--primary)' : 'color-mix(in srgb, var(--primary) 40%, var(--card))',
      color: 'color-mix(in srgb, var(--primary) 82%, var(--foreground))',
      rim: open ? 1.5 : 1,
    };
  }
  // upcoming — quiet neutral
  return {
    fill: 'color-mix(in srgb, var(--muted) 55%, var(--card))',
    border: open ? 'var(--primary)' : 'var(--border)',
    color: 'var(--muted-foreground)',
    rim: open ? 1.5 : 1,
  };
}

/**
 * The Change Management stage pipeline: a compact row of connected chevron steps.
 * Controlled — clicking a stage calls onSelect; the parent owns which is expanded.
 * Purely presentational; stage state comes from the record (stageIndex).
 */
export default function StagePipeline({
  cr, selected, onSelect,
}: {
  cr: ChangeRequest;
  selected: string | null;
  onSelect: (stage: string) => void;
}) {
  const current = stageIndex(cr.stage);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">Stage pipeline</span>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">Stage {current + 1} of {CHANGE_STAGES.length}</span>
          {/* The whole lifecycle at a glance — one button for the change, not per stage. */}
          <Dialog>
            <DialogTrigger className="inline-flex h-7 items-center gap-1.5 rounded-md border border-input bg-background px-2.5 text-xs font-medium shadow-sm outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
              <Workflow className="size-3.5" />
              Workflow
            </DialogTrigger>
            {/* The dialog is portalled to <body>, so without this it would sit
                over the fixed sidebar. --app-content-left (published by Layout)
                is how much room the nav takes; the panel is centred in what is
                left and never wider than that. */}
            <DialogContent
              className="left-[calc(var(--app-content-left)+(100vw-var(--app-content-left))/2)] max-h-[92vh] w-[calc(100vw-var(--app-content-left)-3rem)] max-w-[80rem] overflow-auto"
            >
              <DialogHeader>
                <DialogTitle className="text-base">
                  Workflow · {cr.crNumber}
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    {cr.changeType || 'No change type'} · read-only
                  </span>
                </DialogTitle>
              </DialogHeader>
              <WorkflowDiagram cr={cr} />
            </DialogContent>
          </Dialog>
        </div>
      </div>
      <div className="flex w-full overflow-hidden rounded-lg">
        {CHANGE_STAGES.map((stage, i) => {
          const done = i < current;
          const isCurrent = i === current;
          const isLast = i === CHANGE_STAGES.length - 1;
          const isOpen = selected === stage;
          const clip = isLast ? LAST : i === 0 ? FIRST : MID;
          const look = lookFor(done, isCurrent, isOpen);
          return (
            <button
              type="button"
              key={stage}
              title={stage}
              aria-current={isCurrent ? 'step' : undefined}
              onClick={() => onSelect(stage)}
              className="relative flex min-w-0 flex-1 cursor-pointer flex-col items-center justify-center whitespace-nowrap px-1 text-center text-[11px] font-medium transition-[filter] hover:brightness-[0.98]"
              style={{
                height: 48,
                clipPath: clip,
                background: look.border,
                color: look.color,
                marginLeft: i === 0 ? 0 : -ARROW,
                paddingLeft: i === 0 ? 12 : ARROW + 8,
                paddingRight: isLast ? 12 : ARROW + 4,
                zIndex: isOpen ? CHANGE_STAGES.length + 1 : CHANGE_STAGES.length - i,
              }}
            >
              <span aria-hidden style={{ position: 'absolute', inset: look.rim, clipPath: clip, background: look.fill }} />
              <span className="relative z-10 flex max-w-full items-center gap-1 truncate font-semibold">
                {done && <Check className="size-3 shrink-0" strokeWidth={3} />}
                <span className="truncate">{stage}</span>
              </span>
              {isCurrent && (
                <span className="relative z-10 mt-0.5 text-[9px] font-medium uppercase tracking-wide opacity-90">
                  {isOpen ? 'current · open' : 'current'}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
