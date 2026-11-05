// Per-device UI preferences (theme / accent / font / nav layout).
//
// Deliberately localStorage-only and DOM-only: no schema change, no API call, so
// the panel works for every role without a migration. A later "store on User"
// upgrade only has to replace loadPrefs/savePrefs — applyPrefs stays as is.
//
// The palette lives in index.css: `:root` holds light, `.dark` holds dark, and
// the `dark` class on <html> switches between them. An accent is applied as
// inline custom properties on <html>, which outrank both blocks.

export type ThemePref = 'light' | 'dark' | 'system';
export type NavLayout = 'sidebar' | 'lite' | 'topbar';

export interface Prefs {
  theme: ThemePref;
  accent: string;
  font: string;
  nav: NavLayout;
}

export const DEFAULT_PREFS: Prefs = {
  theme: 'system',
  accent: 'indigo',
  font: 'default',
  nav: 'sidebar',
};

const STORAGE_KEY = 'app:prefs';

// The CSS variables an accent owns. --primary/--ring dress every button, focus
// ring and link; --sidebar-primary is the sidebar's active-item highlight.
const ACCENT_VARS = ['--primary', '--ring', '--accent', '--accent-foreground', '--sidebar-primary', '--sidebar-ring'] as const;

interface AccentTone { primary: string; accent: string; accentFg: string }
export interface Accent { label: string; swatch: string; light: AccentTone; dark: AccentTone }

// `indigo` mirrors the CSS defaults exactly and is applied by *removing* the
// inline overrides, so the stock palette is always the untouched one.
export const ACCENTS: Record<string, Accent> = {
  indigo: {
    label: 'Indigo',
    swatch: 'hsl(243 75% 59%)',
    light: { primary: 'hsl(243 75% 59%)', accent: 'hsl(243 75% 96%)', accentFg: 'hsl(243 75% 30%)' },
    dark: { primary: 'hsl(243 80% 68%)', accent: 'hsl(243 40% 20%)', accentFg: 'hsl(210 20% 96%)' },
  },
  blue: {
    label: 'Blue',
    swatch: 'hsl(217 91% 50%)',
    light: { primary: 'hsl(217 91% 50%)', accent: 'hsl(217 91% 95%)', accentFg: 'hsl(217 91% 28%)' },
    dark: { primary: 'hsl(217 91% 62%)', accent: 'hsl(217 45% 20%)', accentFg: 'hsl(210 20% 96%)' },
  },
  teal: {
    label: 'Teal',
    swatch: 'hsl(173 80% 36%)',
    light: { primary: 'hsl(173 80% 34%)', accent: 'hsl(173 60% 94%)', accentFg: 'hsl(173 80% 22%)' },
    dark: { primary: 'hsl(173 66% 46%)', accent: 'hsl(173 40% 18%)', accentFg: 'hsl(210 20% 96%)' },
  },
  amber: {
    label: 'Amber',
    swatch: 'hsl(38 92% 45%)',
    light: { primary: 'hsl(38 92% 43%)', accent: 'hsl(38 92% 94%)', accentFg: 'hsl(38 92% 26%)' },
    dark: { primary: 'hsl(38 92% 55%)', accent: 'hsl(38 45% 20%)', accentFg: 'hsl(210 20% 96%)' },
  },
  rose: {
    label: 'Rose',
    swatch: 'hsl(347 77% 50%)',
    light: { primary: 'hsl(347 77% 50%)', accent: 'hsl(347 77% 96%)', accentFg: 'hsl(347 77% 30%)' },
    dark: { primary: 'hsl(347 80% 62%)', accent: 'hsl(347 40% 20%)', accentFg: 'hsl(210 20% 96%)' },
  },
};

// Generic stacks only — no webfont fetch, so the app still renders offline.
export const FONTS: Record<string, { label: string; stack: string }> = {
  default: { label: 'System (default)', stack: '' },
  sans: { label: 'Sans', stack: "'Helvetica Neue', Helvetica, Arial, sans-serif" },
  serif: { label: 'Serif', stack: "Georgia, 'Times New Roman', serif" },
  mono: { label: 'Mono', stack: "'JetBrains Mono', 'Cascadia Mono', Consolas, monospace" },
  rounded: { label: 'Rounded', stack: "'Trebuchet MS', Verdana, 'Segoe UI', sans-serif" },
};

export const NAV_LAYOUTS: { value: NavLayout; label: string }[] = [
  { value: 'sidebar', label: 'Sidebar' },
  { value: 'lite', label: 'Sidebar lite' },
  { value: 'topbar', label: 'Top bar' },
];

export const prefersDark = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches;

export const resolveTheme = (theme: ThemePref): 'light' | 'dark' =>
  theme === 'system' ? (prefersDark() ? 'dark' : 'light') : theme;

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const stored = raw ? (JSON.parse(raw) as Partial<Prefs>) : {};
    const merged = { ...DEFAULT_PREFS, ...stored };
    // A pref written by an older build (or hand-edited) must not brick the shell.
    if (!ACCENTS[merged.accent]) merged.accent = DEFAULT_PREFS.accent;
    if (!FONTS[merged.font]) merged.font = DEFAULT_PREFS.font;
    if (!NAV_LAYOUTS.some((n) => n.value === merged.nav)) merged.nav = DEFAULT_PREFS.nav;
    if (!['light', 'dark', 'system'].includes(merged.theme)) merged.theme = DEFAULT_PREFS.theme;
    return merged;
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs: Prefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* private mode / quota — the prefs still apply for this session */
  }
  applyPrefs(prefs);
}

/** Idempotent: paints the whole preference set onto the document. */
export function applyPrefs(prefs: Prefs) {
  const root = document.documentElement;
  const mode = resolveTheme(prefs.theme);

  root.classList.toggle('dark', mode === 'dark');

  const accent = ACCENTS[prefs.accent];
  if (!accent || prefs.accent === DEFAULT_PREFS.accent) {
    // Fall back to the palette in index.css rather than restating it inline.
    ACCENT_VARS.forEach((v) => root.style.removeProperty(v));
  } else {
    const tone = mode === 'dark' ? accent.dark : accent.light;
    root.style.setProperty('--primary', tone.primary);
    root.style.setProperty('--ring', tone.primary);
    root.style.setProperty('--accent', tone.accent);
    root.style.setProperty('--accent-foreground', tone.accentFg);
    root.style.setProperty('--sidebar-primary', tone.primary);
    root.style.setProperty('--sidebar-ring', tone.primary);
  }

  const font = FONTS[prefs.font]?.stack ?? '';
  if (font) document.body.style.fontFamily = font;
  else document.body.style.removeProperty('font-family');
}
