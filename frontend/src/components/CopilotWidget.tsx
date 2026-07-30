import { useState } from 'react';
import { Sparkles, X, ArrowUp } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// Placeholder "Copilot" — static UI only. The real assistant (reply drafting,
// ticket summaries, triage) will be wired up later; for now the controls are inert.
const SUGGESTIONS = [
  'Summarize overdue tickets',
  'Suggest assignees for unassigned',
  'Draft a resolution note',
];

export default function CopilotWidget() {
  const [open, setOpen] = useState(false);
  const comingSoon = () => toast.info('Copilot is coming soon');

  return (
    <>
      <style>{`
        @keyframes copilotTwinkle {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.3; }
        }
        .copilot-spark { animation: copilotTwinkle 1.8s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .copilot-spark { animation: none; }
        }
      `}</style>

      {/* Floating trigger */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="copilot-fab fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg transition-transform duration-200"
        >
          <Sparkles className="copilot-spark size-4" /> Copilot
        </button>
      )}

      {/* Scrim */}
      <div
        onClick={() => setOpen(false)}
        className={cn(
          'fixed inset-0 z-40 bg-black/30 transition-opacity duration-300',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />

      {/* Slide-over panel */}
      <aside
        className={cn(
          'fixed inset-y-0 right-0 z-50 flex w-[360px] max-w-[85vw] flex-col border-l bg-background shadow-xl transition-transform duration-300',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
        aria-hidden={!open}
      >
        {/* Header */}
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <span className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Sparkles className="size-4" />
          </span>
          <span className="text-sm font-semibold text-foreground">Copilot</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">Coming soon</span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="ml-auto flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Close Copilot"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <div className="max-w-[85%] rounded-lg rounded-tl-sm bg-muted px-3 py-2 text-sm text-foreground">
            Hi! I’m your Copilot. Soon I’ll help you summarize tickets, draft replies, and spot SLA risks — right here.
          </div>

          <div>
            <div className="mb-2 text-xs font-medium text-muted-foreground">Try (soon)</div>
            <div className="flex flex-col gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={comingSoon}
                  className="rounded-lg border px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Composer (inert) */}
        <div className="border-t p-3">
          <div className="flex items-center gap-2 rounded-lg border px-3 py-2">
            <input
              disabled
              placeholder="Ask about your queue…"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
            />
            <button
              type="button"
              onClick={comingSoon}
              className="flex size-7 items-center justify-center rounded-md text-primary hover:bg-primary/10"
              aria-label="Send"
            >
              <ArrowUp className="size-4" />
            </button>
          </div>
          <p className="mt-1.5 text-center text-[11px] text-muted-foreground">Copilot isn’t active yet — this is a preview.</p>
        </div>
      </aside>
    </>
  );
}
