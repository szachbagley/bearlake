import { describe, expect, it } from 'vitest';
import {
  camelToSnake,
  dbNow,
  mapKeysToCamel,
  snakeToCamel,
  toApiDateOnly,
  toApiTimestamp,
  toBoolean,
  toDbBoolean,
  toDbDateOnly,
  toDbTimestamp,
} from '../../src/db/mapper.js';

describe('timestamp conversion', () => {
  it('converts a MySQL DATETIME(3) to an ISO UTC string', () => {
    expect(toApiTimestamp('2026-07-17 16:30:00.123')).toBe('2026-07-17T16:30:00.123Z');
  });

  it('pads a missing or short fractional part to milliseconds', () => {
    expect(toApiTimestamp('2026-07-17 16:30:00')).toBe('2026-07-17T16:30:00.000Z');
    expect(toApiTimestamp('2026-07-17 16:30:00.5')).toBe('2026-07-17T16:30:00.500Z');
  });

  it('converts an offset-bearing ISO string to UTC for storage', () => {
    // 10:30 Mountain Daylight Time is 16:30 UTC.
    expect(toDbTimestamp('2026-07-17T10:30:00.123-06:00')).toBe('2026-07-17 16:30:00.123');
  });

  it('round-trips without drift', () => {
    const original = '2026-07-17T16:30:00.123Z';
    expect(toApiTimestamp(toDbTimestamp(original))).toBe(original);
  });

  it('round-trips instants inside both DST transitions', () => {
    // 2026-03-08 09:30Z is inside the US spring-forward gap in Denver;
    // 2026-11-01 08:30Z is inside the fall-back repeated hour.
    for (const instant of ['2026-03-08T09:30:00.000Z', '2026-11-01T08:30:00.000Z']) {
      expect(toApiTimestamp(toDbTimestamp(instant))).toBe(instant);
    }
  });

  it('rejects values that are not MySQL DATETIME strings', () => {
    expect(() => toApiTimestamp('2026-07-17T16:30:00Z')).toThrow(/DATETIME/);
    expect(() => toApiTimestamp('')).toThrow(/DATETIME/);
    expect(() => toDbTimestamp('not a date')).toThrow(/valid timestamp/);
  });

  it('produces a millisecond-precision current timestamp', () => {
    expect(dbNow(new Date('2026-07-17T16:30:00.123Z'))).toBe('2026-07-17 16:30:00.123');
  });
});

describe('all-day date conversion', () => {
  it('stores a date at midnight without timezone math', () => {
    expect(toDbDateOnly('2026-07-17')).toBe('2026-07-17 00:00:00.000');
  });

  it('does not shift a date that falls on a DST transition', () => {
    // The whole point of date-only semantics: 2026-03-08 has no 2am locally in
    // Denver, and an all-day event on that date must still be 2026-03-08.
    expect(toDbDateOnly('2026-03-08')).toBe('2026-03-08 00:00:00.000');
    expect(toApiDateOnly('2026-03-08 00:00:00.000')).toBe('2026-03-08');
  });

  it('round-trips every day of a DST week', () => {
    for (const day of ['03-06', '03-07', '03-08', '03-09', '10-31', '11-01', '11-02']) {
      const date = `2026-${day}`;
      expect(toApiDateOnly(toDbDateOnly(date))).toBe(date);
    }
  });

  it('refuses to read a non-midnight value as a date', () => {
    expect(() => toApiDateOnly('2026-07-17 16:30:00.000')).toThrow(/midnight/);
    expect(() => toApiDateOnly('2026-07-17 00:00:00.001')).toThrow(/midnight/);
  });

  it('rejects malformed date-only input', () => {
    expect(() => toDbDateOnly('2026-7-17')).toThrow(/date-only/);
    expect(() => toDbDateOnly('2026-07-17T00:00:00Z')).toThrow(/date-only/);
  });
});

describe('boolean conversion', () => {
  it('maps TINYINT to boolean and back', () => {
    expect(toBoolean(1)).toBe(true);
    expect(toBoolean(0)).toBe(false);
    expect(toBoolean(true)).toBe(true);
    expect(toDbBoolean(true)).toBe(1);
    expect(toDbBoolean(false)).toBe(0);
  });

  it('rejects a value that is not a boolean column', () => {
    expect(() => toBoolean(null)).toThrow(/boolean/);
    expect(() => toBoolean('1')).toThrow(/boolean/);
  });
});

describe('key conversion', () => {
  it('converts between snake_case and camelCase', () => {
    expect(snakeToCamel('must_change_password')).toBe('mustChangePassword');
    expect(snakeToCamel('id')).toBe('id');
    expect(camelToSnake('mustChangePassword')).toBe('must_change_password');
    expect(camelToSnake('id')).toBe('id');
  });

  it('round-trips a full set of column names', () => {
    const columns = [
      'display_name',
      'password_hash',
      'must_change_password',
      'is_active',
      'last_login_at',
      'schema_version',
      'sort_order',
      'category_id',
      'created_by',
    ];
    for (const column of columns) {
      expect(camelToSnake(snakeToCamel(column))).toBe(column);
    }
  });

  it('converts row keys without touching values', () => {
    expect(mapKeysToCamel({ is_all_day: 1, starts_at: '2026-07-17 16:30:00.000' })).toEqual({
      isAllDay: 1,
      startsAt: '2026-07-17 16:30:00.000',
    });
  });
});
