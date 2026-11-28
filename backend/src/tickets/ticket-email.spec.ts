import { formatTenantDate, formatTenantStamp } from './ticket-email';

describe('ticket email dates', () => {
  const at = new Date('2026-11-28T13:28:00Z');

  it('prints a stamp on the tenant wall clock, with its zone', () => {
    expect(formatTenantStamp(at, { dateFormat: 'dd/MM/yyyy', timeFormat: 'HH:mm', timeZone: 'Asia/Kolkata' }))
      .toBe('28/11/2026 18:58 IST');
    expect(formatTenantStamp(at, { dateFormat: 'MMM dd, yyyy', timeFormat: 'hh:mm a', timeZone: 'America/New_York' }))
      .toBe('Nov 28, 2026 08:28 am EST');
  });

  it('rolls the date over when the zone is past midnight', () => {
    expect(formatTenantStamp(new Date('2026-11-28T19:00:00Z'), { timeZone: 'Asia/Kolkata' })).toBe('29/11/2026 00:30 IST');
  });

  it('falls back to UTC for an unknown zone, and to the default formats', () => {
    expect(formatTenantStamp(at, { timeZone: 'Mars/Olympus' })).toBe('28/11/2026 13:28 UTC');
    expect(formatTenantStamp(null, {})).toBeNull();
    expect(formatTenantDate(at, 'dd/MM/yyyy', 'Asia/Kolkata')).toBe('28/11/2026');
  });
});
