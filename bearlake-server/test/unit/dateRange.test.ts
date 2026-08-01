import { describe, expect, it } from 'vitest';
import { denverDateOf, windowDenverDates } from '../../src/services/dateRange.js';

describe('denverDateOf', () => {
  it('maps an instant to the Denver calendar date it falls on', () => {
    // 06:00 UTC on Jul 20 is midnight Denver (MDT, -06:00): still Jul 20.
    expect(denverDateOf(new Date('2026-07-20T06:00:00.000Z'))).toBe('2026-07-20');
    // 05:59 UTC is 23:59 Denver on Jul 19.
    expect(denverDateOf(new Date('2026-07-20T05:59:00.000Z'))).toBe('2026-07-19');
  });

  it('uses the correct offset on each side of a DST transition', () => {
    // Standard time (MST, -07:00) in winter: 06:59 UTC is still Jan 31 Denver.
    expect(denverDateOf(new Date('2026-02-01T06:59:00.000Z'))).toBe('2026-01-31');
    expect(denverDateOf(new Date('2026-02-01T07:00:00.000Z'))).toBe('2026-02-01');
    // Daylight time (MDT, -06:00) in summer: 05:59 UTC is still Jul 31 Denver.
    expect(denverDateOf(new Date('2026-08-01T05:59:00.000Z'))).toBe('2026-07-31');
    expect(denverDateOf(new Date('2026-08-01T06:00:00.000Z'))).toBe('2026-08-01');
  });

  it('resolves the spring-forward day, which has no 02:00 local hour', () => {
    // 2026-03-08: clocks jump 02:00→03:00. The date is still well defined.
    expect(denverDateOf(new Date('2026-03-08T09:00:00.000Z'))).toBe('2026-03-08');
    expect(denverDateOf(new Date('2026-03-08T06:59:00.000Z'))).toBe('2026-03-07');
  });

  it('resolves the fall-back day, which repeats its 01:00 local hour', () => {
    // 2026-11-01: clocks fall 02:00→01:00.
    expect(denverDateOf(new Date('2026-11-01T07:59:00.000Z'))).toBe('2026-11-01');
    expect(denverDateOf(new Date('2026-11-01T05:59:00.000Z'))).toBe('2026-10-31');
  });
});

describe('windowDenverDates', () => {
  it('covers whole Denver days for a month-aligned window', () => {
    // July 2026 as sent by a Denver client: Jul 1 00:00 to Aug 1 00:00 local.
    const dates = windowDenverDates(
      new Date('2026-07-01T06:00:00.000Z'),
      new Date('2026-08-01T06:00:00.000Z'),
    );
    // Aug 1 00:00 is the exclusive end, so the window covers July only.
    expect(dates).toEqual({ firstDate: '2026-07-01', lastDate: '2026-07-31' });
  });

  it('treats a single-day window as that one date', () => {
    const dates = windowDenverDates(
      new Date('2026-07-20T06:00:00.000Z'),
      new Date('2026-07-21T06:00:00.000Z'),
    );
    expect(dates).toEqual({ firstDate: '2026-07-20', lastDate: '2026-07-20' });
  });

  it('does not claim the day that begins exactly at the window end', () => {
    // End at midnight Denver on Jul 21 must not pull Jul 21 into the window.
    const dates = windowDenverDates(
      new Date('2026-07-19T06:00:00.000Z'),
      new Date('2026-07-21T06:00:00.000Z'),
    );
    expect(dates.lastDate).toBe('2026-07-20');
  });

  it('spans a DST boundary without losing or gaining a day', () => {
    // March 2026 contains the spring-forward transition.
    const dates = windowDenverDates(
      new Date('2026-03-01T07:00:00.000Z'),
      new Date('2026-04-01T06:00:00.000Z'),
    );
    expect(dates).toEqual({ firstDate: '2026-03-01', lastDate: '2026-03-31' });
  });
});
