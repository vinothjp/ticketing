import { Check, Monitor, Moon, RotateCcw, Sun } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { usePrefs } from '../context/PreferencesContext';
import {
  ACCENTS, DEFAULT_PREFS, FONTS, NAV_LAYOUTS,
  type NavLayout, type ThemePref,
} from '../lib/preferences';
import { cn } from '@/lib/utils';

const THEMES: { value: ThemePref; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 text-[10px] font-semibold tracking-wider uppercase text-muted-foreground">{children}</div>;
}

// Miniature of each nav layout, drawn from divs — a picture reads faster than
// three words that all say "sidebar".
function NavPreview({ layout, active }: { layout: NavLayout; active: boolean }) {
  const bar = active ? 'bg-primary' : 'bg-muted-foreground/40';
  return (
    <div className="flex h-8 w-full gap-0.5 overflow-hidden rounded-sm border bg-background p-0.5">
      {layout !== 'topbar' && <div className={cn('shrink-0 rounded-[2px]', bar, layout === 'lite' ? 'w-1.5' : 'w-3')} />}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {layout === 'topbar' && <div className={cn('h-1.5 w-full rounded-[2px]', bar)} />}
        <div className="flex-1 rounded-[2px] bg-muted" />
      </div>
    </div>
  );
}

/**
 * The personalization panel shown inside the avatar dropdown. Everything here is
 * per-device (localStorage) and applied straight to the document by usePrefs.
 */
export default function PreferencesMenu() {
  const { user } = useAuth();
  const { prefs, updatePrefs } = usePrefs();

  return (
    <div className="px-1 py-1.5">
      <div className="mb-3 flex items-center gap-2.5 px-1.5">
        <div className="relative shrink-0">
          <div className="flex size-9 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
            {user?.username?.slice(0, 2).toUpperCase()}
          </div>
          <span className="absolute right-0 bottom-0 size-2.5 rounded-full border-2 border-popover bg-emerald-500" title="Online" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-foreground">{user?.username}</div>
          <div className="truncate text-xs text-muted-foreground">{user?.roles.join(' · ')}</div>
        </div>
      </div>

      <div className="mb-3">
        <SectionLabel>Theme</SectionLabel>
        <div className="grid grid-cols-3 gap-1.5">
          {THEMES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => updatePrefs({ theme: t.value })}
              className={cn(
                'flex flex-col items-center gap-1 rounded-md border py-2 text-[11px] font-medium transition-colors hover:bg-accent',
                prefs.theme === t.value ? 'border-primary text-primary ring-2 ring-primary/40' : 'text-muted-foreground',
              )}
            >
              <t.icon className="size-4" />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-3">
        <div className="mb-1.5 flex items-center justify-between">
          <SectionLabel>Accent colour</SectionLabel>
          <button
            type="button"
            onClick={() => updatePrefs({ accent: DEFAULT_PREFS.accent })}
            className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="size-3" />
            Reset
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {Object.entries(ACCENTS).map(([key, accent]) => (
            <button
              key={key}
              type="button"
              title={accent.label}
              onClick={() => updatePrefs({ accent: key })}
              style={{ background: accent.swatch }}
              className={cn(
                'flex size-7 items-center justify-center rounded-full transition-transform hover:scale-110',
                prefs.accent === key && 'ring-2 ring-foreground/60 ring-offset-2 ring-offset-popover',
              )}
            >
              {prefs.accent === key && <Check className="size-3.5 text-white" strokeWidth={3} />}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-3">
        <SectionLabel>Font</SectionLabel>
        {/* A plain <select>: a Radix Select inside an open dropdown nests two
            portalled layers and traps focus against each other. */}
        <select
          value={prefs.font}
          onChange={(e) => updatePrefs({ font: e.target.value })}
          className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {Object.entries(FONTS).map(([key, f]) => (
            <option key={key} value={key} style={{ fontFamily: f.stack || undefined }}>{f.label}</option>
          ))}
        </select>
      </div>

      <div>
        <SectionLabel>Navigation layout</SectionLabel>
        <div className="grid grid-cols-3 gap-1.5">
          {NAV_LAYOUTS.map((n) => (
            <button
              key={n.value}
              type="button"
              onClick={() => updatePrefs({ nav: n.value })}
              className={cn(
                'flex flex-col items-center gap-1 rounded-md border p-1.5 text-[10px] font-medium transition-colors hover:bg-accent',
                prefs.nav === n.value ? 'border-primary text-primary ring-2 ring-primary/40' : 'text-muted-foreground',
              )}
            >
              <NavPreview layout={n.value} active={prefs.nav === n.value} />
              {n.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
