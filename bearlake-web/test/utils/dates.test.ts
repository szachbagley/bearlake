import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cabinTimeEcho,
  formatAllDayRange,
  formatDateOnly,
  formatInstant,
  formatRelativeTime,
  getEventsFetchWindow,
  getMonthGrid,
  instantToLocalInputValue,
  isCompleteLocalInputValue,
  localDateOnlyOfInstant,
  localInputValueToInstant,
  parseDateOnly,
  shiftMonth,
  todayDateOnly,
  toDateOnlyString,
  withYear,
} from '../../src/utils/dates.ts';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('formatInstant', () => {
  it('formats an ISO instant as a readable local date and time', () => {
    const formatted = formatInstant('2026-07-16T18:30:00.000Z');
    expect(formatted).toMatch(/2026/);
    expect(formatted).toMatch(/\d/);
  });
});

describe('parseDateOnly / toDateOnlyString', () => {
  it('round-trips without touching Date', () => {
    expect(parseDateOnly('2026-07-16')).toEqual({ year: 2026, month: 7, day: 16 });
    expect(toDateOnlyString({ year: 2026, month: 7, day: 16 })).toBe('2026-07-16');
  });

  it('zero-pads single-digit months and days', () => {
    expect(toDateOnlyString({ year: 2026, month: 2, day: 5 })).toBe('2026-02-05');
  });

  it('throws on malformed input rather than silently returning NaN components', () => {
    expect(() => parseDateOnly('not-a-date')).toThrow();
  });
});

describe('formatRelativeTime', () => {
  it('formats a past instant relative to a pinned "now"', () => {
    const now = new Date(Date.UTC(2026, 6, 20, 12, 0, 0));
    expect(formatRelativeTime('2026-07-15T12:00:00.000Z', now)).toBe('5 days ago');
  });

  it('formats a future instant relative to a pinned "now"', () => {
    const now = new Date(Date.UTC(2026, 6, 20, 12, 0, 0));
    expect(formatRelativeTime('2026-07-22T12:00:00.000Z', now)).toBe('in 2 days');
  });
});

describe('formatDateOnly / formatAllDayRange', () => {
  it('formats a single date-only string', () => {
    expect(formatDateOnly('2026-07-16')).toBe('Jul 16, 2026');
  });

  it('formats a same-day range as a single date', () => {
    expect(formatAllDayRange('2026-07-16', '2026-07-16')).toBe('Jul 16, 2026');
  });

  it('formats a multi-day range within one year without repeating the year', () => {
    expect(formatAllDayRange('2026-07-16', '2026-07-20')).toBe('Jul 16 – Jul 20, 2026');
  });

  it('formats a range spanning a year boundary with both years shown', () => {
    expect(formatAllDayRange('2026-12-30', '2027-01-02')).toBe('Dec 30, 2026 – Jan 2, 2027');
  });

  it('never shifts a day, at extreme timezones on both sides of UTC', () => {
    for (const tz of ['Etc/GMT-13', 'Etc/GMT+11', 'America/Denver', 'UTC']) {
      vi.stubEnv('TZ', tz);
      expect(formatDateOnly('2026-07-16')).toBe('Jul 16, 2026');
      expect(formatAllDayRange('2026-07-16', '2026-07-20')).toBe('Jul 16 – Jul 20, 2026');
    }
  });
});

describe('todayDateOnly / localDateOnlyOfInstant', () => {
  it('reads today from a fixed Date via numeric getters', () => {
    expect(todayDateOnly(new Date(2026, 6, 16))).toBe('2026-07-16');
  });

  it('maps a UTC instant to the viewer local calendar date', () => {
    // 11pm Jul 15 Mountain (UTC-6 in July) is 5am UTC Jul 16.
    vi.stubEnv('TZ', 'America/Denver');
    expect(localDateOnlyOfInstant('2026-07-16T05:00:00.000Z')).toBe('2026-07-15');
  });

  it('the same instant maps to a different local date for a viewer on the other side of the world', () => {
    vi.stubEnv('TZ', 'Pacific/Kiritimati'); // UTC+14
    expect(localDateOnlyOfInstant('2026-07-16T05:00:00.000Z')).toBe('2026-07-16');
  });
});

describe('shiftMonth', () => {
  it('moves forward a month, keeping the day', () => {
    expect(shiftMonth('2026-07-16', 1)).toBe('2026-08-16');
  });

  it('moves backward a month across a year boundary', () => {
    expect(shiftMonth('2026-01-16', -1)).toBe('2025-12-16');
  });

  it('clamps the day when the target month is shorter (Jan 31 -> Feb)', () => {
    expect(shiftMonth('2026-01-31', 1)).toBe('2026-02-28');
  });

  it('clamps onto a leap-year Feb 29 correctly', () => {
    expect(shiftMonth('2024-01-31', 1)).toBe('2024-02-29');
  });

  it('is unaffected by the viewer timezone', () => {
    for (const tz of ['Etc/GMT-13', 'Etc/GMT+11']) {
      vi.stubEnv('TZ', tz);
      expect(shiftMonth('2026-01-31', 1)).toBe('2026-02-28');
    }
  });
});

describe('withYear', () => {
  it('moves to the same month/day in a different year', () => {
    expect(withYear('2026-07-16', 2030)).toBe('2030-07-16');
  });

  it('clamps Feb 29 into a non-leap year', () => {
    expect(withYear('2024-02-29', 2026)).toBe('2026-02-28');
  });
});

describe('getMonthGrid', () => {
  it('produces a 42-cell, Sunday-start grid covering the whole month', () => {
    const grid = getMonthGrid('2026-07-01');
    expect(grid).toHaveLength(42);
    const inMonth = grid.filter((d) => d.inMonth);
    expect(inMonth).toHaveLength(31); // July has 31 days
    expect(inMonth[0]?.date).toBe('2026-07-01');
    expect(inMonth[inMonth.length - 1]?.date).toBe('2026-07-31');
  });

  it('includes leading/trailing days from adjacent months, marked as not in-month', () => {
    const grid = getMonthGrid('2026-07-01');
    expect(grid[0]?.inMonth).toBe(false);
    expect(grid[grid.length - 1]?.inMonth).toBe(false);
  });

  it('produces an identical grid regardless of the viewer timezone', () => {
    const reference = getMonthGrid('2026-07-01').map((d) => d.date);
    for (const tz of ['Etc/GMT-13', 'Etc/GMT+11', 'America/Denver']) {
      vi.stubEnv('TZ', tz);
      expect(getMonthGrid('2026-07-01').map((d) => d.date)).toEqual(reference);
    }
  });
});

describe('getEventsFetchWindow', () => {
  it('spans the visible month plus one month on each side, as UTC instants', () => {
    const { start, end } = getEventsFetchWindow('2026-07-16');
    expect(start).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(end).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(new Date(start).getTime()).toBeLessThan(new Date(end).getTime());
  });

  it('stays well within the server-s 366-day cap', () => {
    const { start, end } = getEventsFetchWindow('2026-07-16');
    const spanDays = (new Date(end).getTime() - new Date(start).getTime()) / (24 * 60 * 60 * 1000);
    expect(spanDays).toBeLessThanOrEqual(366);
    expect(spanDays).toBeGreaterThan(80); // roughly three months
  });
});

describe('timed-event local <-> instant conversion (W17), across both 2026 DST transitions', () => {
  it('spring-forward: 1:59am and 3:00am Denver are both valid, 30 minutes apart in UTC', () => {
    vi.stubEnv('TZ', 'America/Denver');
    // 2026-03-08 02:00 local does not exist (clocks jump 2am -> 3am MDT).
    const before = localInputValueToInstant('2026-03-08T01:59');
    const after = localInputValueToInstant('2026-03-08T03:00');
    expect(before).toBe('2026-03-08T08:59:00.000Z'); // MST, UTC-7
    expect(after).toBe('2026-03-08T09:00:00.000Z'); // MDT, UTC-6
  });

  it('fall-back: 2026-11-01 1:30am Denver resolves to MDT (the first occurrence)', () => {
    vi.stubEnv('TZ', 'America/Denver');
    // JS Date resolves an ambiguous local wall-clock time to its first
    // occurrence (still-daylight-time), which is what `new Date(local)` gives.
    expect(localInputValueToInstant('2026-11-01T01:30')).toBe('2026-11-01T07:30:00.000Z');
  });

  it('a full day after fall-back is firmly on standard time', () => {
    vi.stubEnv('TZ', 'America/Denver');
    expect(localInputValueToInstant('2026-11-02T12:00')).toBe('2026-11-02T19:00:00.000Z'); // MST, UTC-7
  });

  it('instantToLocalInputValue is the inverse of localInputValueToInstant across the spring transition', () => {
    vi.stubEnv('TZ', 'America/Denver');
    for (const local of ['2026-03-07T15:00', '2026-03-09T15:00']) {
      expect(instantToLocalInputValue(localInputValueToInstant(local))).toBe(local);
    }
  });
});

describe('isCompleteLocalInputValue', () => {
  it('is false for an empty string (a datetime-local input mid-entry)', () => {
    expect(isCompleteLocalInputValue('')).toBe(false);
  });

  it('is true for a complete datetime-local value', () => {
    expect(isCompleteLocalInputValue('2026-07-16T15:00')).toBe(true);
  });
});

describe('cabinTimeEcho', () => {
  it('returns null when the viewer is already in America/Denver', () => {
    vi.stubEnv('TZ', 'America/Denver');
    expect(cabinTimeEcho('2026-07-16T18:00:00.000Z')).toBeNull();
  });

  it('returns a cabin-time-formatted string for a viewer elsewhere', () => {
    vi.stubEnv('TZ', 'America/New_York');
    const echo = cabinTimeEcho('2026-07-16T18:00:00.000Z');
    expect(echo).not.toBeNull();
    expect(echo).toMatch(/2026/);
  });
});
