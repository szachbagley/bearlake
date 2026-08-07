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
