import { offeredIssueTypes, pickLeastLoaded, routingIssueType } from './auto-assign';

describe('pickLeastLoaded', () => {
  const loads: Record<string, number> = {};
  const load = (id: string) => loads[id] ?? 0;
  const active = (id: string) => id !== 'gone';

  beforeEach(() => { for (const k of Object.keys(loads)) delete loads[k]; });

  it('gives the primary the first ticket when everyone is on zero', () => {
    expect(pickLeastLoaded(['P', 'A', 'B'], load, active, 10)).toBe('P');
  });

  it('spreads: the fewest open tickets wins, the earlier one on a tie', () => {
    loads.P = 1;
    expect(pickLeastLoaded(['P', 'A', 'B'], load, active, 10)).toBe('A');
    loads.A = 1;
    expect(pickLeastLoaded(['P', 'A', 'B'], load, active, 10)).toBe('B');
    loads.B = 1;
    expect(pickLeastLoaded(['P', 'A', 'B'], load, active, 10)).toBe('P');
  });

  it('skips anyone at the max, and returns null when the whole step is full', () => {
    loads.P = 10; loads.A = 3;
    expect(pickLeastLoaded(['P', 'A'], load, active, 10)).toBe('A');
    loads.A = 10;
    expect(pickLeastLoaded(['P', 'A'], load, active, 10)).toBeNull();
  });

  it('has no ceiling when the max is null', () => {
    loads.P = 500; loads.A = 499;
    expect(pickLeastLoaded(['P', 'A'], load, active, null)).toBe('A');
  });

  it('never picks an inactive user, and ignores repeats', () => {
    expect(pickLeastLoaded(['gone', 'A', 'A'], load, active, 10)).toBe('A');
    expect(pickLeastLoaded(['gone'], load, active, 10)).toBeNull();
  });
});

describe('routingIssueType', () => {
  const all = offeredIssueTypes(['TECHNICAL', 'FUNCTIONAL', 'OTHERS']);

  it('uses the picked issue type', () => {
    expect(routingIssueType('FUNCTIONAL', 'TECHNICAL', all)).toBe('FUNCTIONAL');
    expect(routingIssueType('OTHERS', 'TECHNICAL', all)).toBe('OTHERS');
  });

  it('falls back to the organization default when none was picked', () => {
    expect(routingIssueType(null, 'FUNCTIONAL', all)).toBe('FUNCTIONAL');
    expect(routingIssueType(undefined, 'OTHERS', all)).toBe('OTHERS');
  });

  it("never routes on a type the module doesn't offer", () => {
    expect(routingIssueType(null, 'TECHNICAL', offeredIssueTypes(['FUNCTIONAL']))).toBe('FUNCTIONAL');
    expect(routingIssueType(null, 'OTHERS', offeredIssueTypes(['TECHNICAL', 'FUNCTIONAL']))).toBe('TECHNICAL');
  });

  it('treats a module with no tracks as Technical + Functional', () => {
    expect(offeredIssueTypes([])).toEqual(['TECHNICAL', 'FUNCTIONAL']);
  });
});
