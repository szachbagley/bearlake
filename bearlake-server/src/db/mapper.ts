/**
 * The one place MySQL representations and API representations meet (plan D14).
 *
 * Three formats are in play, and mixing them up is the bug this module exists
 * to prevent:
 *
 *   MySQL DATETIME(3)  '2026-07-17 16:30:00.123'   always UTC, no offset
 *   API timestamp      '2026-07-17T16:30:00.123Z'  ISO-8601, always UTC
 *   API date-only      '2026-07-17'                all-day events (plan D15)
 *
 * Nothing outside this module may format or parse a timestamp, and nothing in
 * it may consult the host's local timezone.
 */

const DB_TIMESTAMP_PATTERN =
  /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?$/;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** MySQL DATETIME(3) string -> ISO-8601 UTC string. */
export function toApiTimestamp(value: string): string {
  const match = DB_TIMESTAMP_PATTERN.exec(value);
  if (match === null) {
    throw new Error(`Not a MySQL DATETIME value: ${JSON.stringify(value)}`);
  }
  const [, date, time, fraction = ''] = match;
  const milliseconds = fraction.slice(0, 3).padEnd(3, '0');
  return `${String(date)}T${String(time)}.${milliseconds}Z`;
}

/** ISO-8601 string (any offset) or Date -> MySQL DATETIME(3) string in UTC. */
export function toDbTimestamp(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Not a valid timestamp: ${JSON.stringify(value)}`);
  }
  // toISOString is always UTC, which is exactly the conversion wanted here.
  return date.toISOString().slice(0, 23).replace('T', ' ');
}

/**
 * MySQL DATETIME(3) string -> 'YYYY-MM-DD' for an all-day event.
 *
 * All-day events are stored at exactly midnight and carry date semantics, not
 * instant semantics; a stored value with a time component means a timed event
 * was written through an all-day path, which is a bug worth surfacing loudly.
 */
export function toApiDateOnly(value: string): string {
  const match = DB_TIMESTAMP_PATTERN.exec(value);
  if (match === null) {
    throw new Error(`Not a MySQL DATETIME value: ${JSON.stringify(value)}`);
  }
  const [, date, time, fraction = ''] = match;
  if (time !== '00:00:00' || Number(fraction) !== 0) {
    throw new Error(`All-day value is not midnight: ${JSON.stringify(value)}`);
  }
  return String(date);
}

/** 'YYYY-MM-DD' -> MySQL DATETIME(3) string at midnight, no timezone math. */
export function toDbDateOnly(value: string): string {
  if (!DATE_ONLY_PATTERN.test(value)) {
    throw new Error(`Not a date-only value: ${JSON.stringify(value)}`);
  }
  // Deliberately string concatenation rather than Date parsing: constructing a
  // Date here would introduce a timezone and shift the day.
  return `${value} 00:00:00.000`;
}

/** Current instant as a MySQL DATETIME(3) string. The app owns all timestamps. */
export function dbNow(clock: Date = new Date()): string {
  return toDbTimestamp(clock);
}

/** MySQL TINYINT(1) -> boolean. */
export function toBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  throw new Error(`Not a boolean column value: ${JSON.stringify(value)}`);
}

/** boolean -> MySQL TINYINT(1). */
export function toDbBoolean(value: boolean): number {
  return value ? 1 : 0;
}

export function snakeToCamel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_match, char: string) => char.toUpperCase());
}

export function camelToSnake(key: string): string {
  return key.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`);
}

/**
 * Shallow key conversion for a database row. Values are untouched — timestamp
 * and boolean conversion is per-column and belongs to the entity's own mapper,
 * which knows which columns are which.
 */
export function mapKeysToCamel(row: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    result[snakeToCamel(key)] = value;
  }
  return result;
}
