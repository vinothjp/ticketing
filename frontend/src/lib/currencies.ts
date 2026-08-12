// Currency list + lightweight conversion used for project budgets.
// `rate` = units of this currency per 1 USD (approximate, static — good enough
// for a budget figure; swap for a live FX feed if precise rates are needed).
export interface Currency { code: string; name: string; rate: number }

export const CURRENCIES: Currency[] = [
  { code: 'USD', name: 'US Dollar', rate: 1 },
  { code: 'EUR', name: 'Euro', rate: 0.92 },
  { code: 'GBP', name: 'British Pound', rate: 0.79 },
  { code: 'INR', name: 'Indian Rupee', rate: 83.2 },
  { code: 'AED', name: 'UAE Dirham', rate: 3.67 },
  { code: 'AUD', name: 'Australian Dollar', rate: 1.52 },
  { code: 'CAD', name: 'Canadian Dollar', rate: 1.36 },
  { code: 'SGD', name: 'Singapore Dollar', rate: 1.34 },
  { code: 'JPY', name: 'Japanese Yen', rate: 149 },
];

const DEFAULT = 'USD';
const rateOf = (code?: string | null) =>
  CURRENCIES.find((c) => c.code === (code || DEFAULT))?.rate ?? 1;

/** Convert an amount between currencies (via USD). Rounded to 2 dp. */
export function convertAmount(amount: number, from?: string | null, to?: string | null): number {
  if (!amount || from === to) return amount;
  const usd = amount / rateOf(from);
  return Math.round(usd * rateOf(to) * 100) / 100;
}

/** Format an amount with its currency code, e.g. "150,000 USD". */
export function formatMoney(amount?: number | null, currency?: string | null): string {
  if (amount == null) return '—';
  return `${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${currency || DEFAULT}`;
}
