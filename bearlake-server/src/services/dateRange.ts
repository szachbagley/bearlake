/**
 * Day-boundary logic for the events range query (plan D16).
 *
 * This is the one place the property's timezone enters the server. Timed events
 * are compared as UTC instants and never touch this file; all-day events are
 * calendar dates and must be compared against the *Denver* dates the query
 * window covers, or an all-day event drifts onto the wrong day for a viewer in
 * another timezone.
 *
 * No date library and no `+ 86400`: conversion is done with `Intl`, and the
 * one-millisecond step below is a boundary adjustment, not day arithmetic.
 */

const DENVER_TIME_ZONE = 'America/Denver';

const denverDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: DENVER_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The calendar date, in America/Denver, on which an instant falls. */
export function denverDateOf(instant: Date): string {
  const parts = denverDateFormatter.formatToParts(instant);
  const values: Record<string, string> = {};
  for (const part of parts) {
    values[part.type] = part.value;
  }
  const { year, month, day } = values;
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error('Intl did not yield a full date for the instant.');
  }
  return `${year}-${month}-${day}`;
}

export interface WindowDates {
  /** First Denver calendar date the window touches. */
  firstDate: string;
  /** Last Denver calendar date the window touches (inclusive). */
  lastDate: string;
}

/**
 * The inclusive span of Denver calendar dates that a half-open instant window
 * [start, end) touches.
 *
 * `lastDate` is computed from the instant one millisecond before `end`: the
 * window is exclusive of `end`, so a window ending exactly at Denver midnight
 * must not claim the day that begins there. A July fetch ending at Aug 1
 * 00:00 Denver covers July 1–31, not August 1.
 */
export function windowDenverDates(start: Date, end: Date): WindowDates {
  const lastInstant = new Date(end.getTime() - 1);
  return {
    firstDate: denverDateOf(start),
    lastDate: denverDateOf(lastInstant),
  };
}
