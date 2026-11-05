import { useQuery } from '@tanstack/react-query';
import api from './api';

/**
 * The tenant's date format, and the renderer for it.
 *
 * Dates on the ticket screens used to be `toLocaleDateString()` — whatever the
 * *browser* was set to, which is not what an organization means when it says its
 * dates are dd/MM/yyyy. The pattern now comes from `Client.dateFormat`, chosen on
 * the Organization screen from the DATE_FORMAT option list, so a tenant sees one
 * format on every machine.
 *
 * Patterns are tokens, not locale names, because an admin edits the list: a value
 * added there must use the tokens below or it renders literally.
 */

/** The fallbacks, matching `Client.dateFormat` / `Client.timeFormat`'s own defaults. */
export const DEFAULT_DATE_FORMAT = 'dd/MM/yyyy';
export const DEFAULT_TIME_FORMAT = 'HH:mm';

const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTHS_SHORT = MONTHS_LONG.map((m) => m.slice(0, 3));

const pad = (n: number) => String(n).padStart(2, '0');

// Longest-first, so `MMMM` is never matched as `MMM` + `M`. Anything outside a
// token — separators, spaces, a stray word — is copied through untouched.
const TOKEN = /yyyy|yy|MMMM|MMM|MM|M|dd|d|HH|hh|mm|ss|a/g;

/** Does this pattern already say what to do with the time half? */
const hasTime = (pattern: string) => /HH|hh|mm|ss|a/.test(pattern);

/**
 * Render one date with a token pattern. Returns an em dash for a null or
 * unparseable value, so a call site never has to guard first.
 */
export function formatWithPattern(
  value: string | number | Date | null | undefined,
  pattern: string = DEFAULT_DATE_FORMAT,
): string {
  if (value === null || value === undefined || value === '') return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';

  const h12 = d.getHours() % 12 || 12;
  return pattern.replace(TOKEN, (t) => {
    switch (t) {
      case 'yyyy': return String(d.getFullYear());
      case 'yy': return pad(d.getFullYear() % 100);
      case 'MMMM': return MONTHS_LONG[d.getMonth()];
      case 'MMM': return MONTHS_SHORT[d.getMonth()];
      case 'MM': return pad(d.getMonth() + 1);
      case 'M': return String(d.getMonth() + 1);
      case 'dd': return pad(d.getDate());
      case 'd': return String(d.getDate());
      case 'HH': return pad(d.getHours());
      case 'hh': return pad(h12);
      case 'mm': return pad(d.getMinutes());
      case 'ss': return pad(d.getSeconds());
      case 'a': return d.getHours() < 12 ? 'am' : 'pm';
      default: return t;
    }
  });
}

/**
 * The same date with the tenant's clock appended — unless the date pattern
 * already places the time itself, in which case it is left alone.
 */
export function formatDateTimeWithPattern(
  value: string | number | Date | null | undefined,
  pattern: string = DEFAULT_DATE_FORMAT,
  timePattern: string = DEFAULT_TIME_FORMAT,
): string {
  return formatWithPattern(value, hasTime(pattern) ? pattern : `${pattern} ${timePattern}`);
}

interface MyClient {
  name: string;
  logoUrl?: string | null;
  dateFormat?: string | null;
  timeFormat?: string | null;
}

/**
 * The tenant's pattern plus the two formatters bound to it.
 *
 * Rides on `GET /api/auth/me/client` — the one client read every logged-in user
 * has, staff and customer contacts alike — and shares `Layout`'s existing
 * `['my-client']` cache entry, so it costs no extra request.
 */
export function useDateFormat() {
  const { data } = useQuery<MyClient | null>({
    queryKey: ['my-client'],
    queryFn: async () => (await api.get('/api/auth/me/client')).data,
    staleTime: 5 * 60 * 1000,
  });
  const pattern = data?.dateFormat || DEFAULT_DATE_FORMAT;
  const timePattern = data?.timeFormat || DEFAULT_TIME_FORMAT;
  return {
    pattern,
    timePattern,
    /** Date only, in the tenant's format. */
    fmtDate: (v: string | number | Date | null | undefined) => formatWithPattern(v, pattern),
    /** Date and time — the date format with the tenant's own clock appended. */
    fmtDateTime: (v: string | number | Date | null | undefined) =>
      formatDateTimeWithPattern(v, pattern, timePattern),
  };
}
