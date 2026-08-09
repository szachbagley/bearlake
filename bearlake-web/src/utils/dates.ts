/**
 * The single home for date/time formatting (plan W17/W18/W19). Starts
 * minimal here in Phase 4 with just what announcements needs; Phase 6 adds
 * date-only (all-day) formatting, month-grid enumeration, and the cabin-time
 * echo alongside this.
 *
 * `postedAt` (and every other server timestamp used so far) is a full ISO
 * instant with an offset, not a bare date-only string — `new Date(iso)`
 * parses that unambiguously in every timezone. The banned pattern (W19) is
 * specifically `new Date('2026-07-16')`-style **date-only** literals, which
 * parse as UTC midnight and render a day early for negative-offset viewers;
 * it doesn't apply to instants like this one.
 */
export function formatInstant(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}

const RELATIVE_UNITS: { unit: Intl.RelativeTimeFormatUnit; ms: number }[] = [
  { unit: 'year', ms: 365 * 24 * 60 * 60 * 1000 },
  { unit: 'month', ms: 30 * 24 * 60 * 60 * 1000 },
  { unit: 'week', ms: 7 * 24 * 60 * 60 * 1000 },
  { unit: 'day', ms: 24 * 60 * 60 * 1000 },
  { unit: 'hour', ms: 60 * 60 * 1000 },
  { unit: 'minute', ms: 60 * 1000 },
];

/**
 * "3 days ago" / "in 2 hours" (plan Phase 5 step 1: users' last-login column
 * shows relative time, with the absolute instant on hover via `formatInstant`
 * in a `title` attribute). `now` is injectable so tests can pin it instead of
 * racing the real clock.
 */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const diffMs = new Date(iso).getTime() - now.getTime();
  const absMs = Math.abs(diffMs);

  if (absMs < 60_000) return 'just now';

  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const { unit, ms } of RELATIVE_UNITS) {
    if (absMs >= ms) {
      return formatter.format(Math.round(diffMs / ms), unit);
    }
  }
  return 'just now';
}
