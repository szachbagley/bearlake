/**
 * The single home for date/time formatting (plan W17/W18/W19).
 *
 * `postedAt` (and every other server timestamp used so far) is a full ISO
 * instant with an offset, not a bare date-only string — `new Date(iso)`
 * parses that unambiguously in every timezone. The banned pattern (W19) is
 * specifically `new Date('2026-07-16')`-style **date-only** literals, which
 * parse as UTC midnight and render a day early for negative-offset viewers;
 * it doesn't apply to instants like this one.
 *
 * All-day event dates (`YYYY-MM-DD`) are the opposite case: they are never
 * passed to `new Date` at all (W19). They're parsed into components and
 * formatted or compared directly — comparison is lexicographic, since the
 * fixed-width format sorts chronologically as plain text.
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

// ── Date-only (all-day) helpers — Phase 6, W19 ──────────────────────────────

const MONTH_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

export interface DateOnlyParts {
  year: number;
  /** 1-indexed (1 = January), matching the wire format — not JS's 0-indexed `Date.getMonth()`. */
  month: number;
  day: number;
}

/** Splits `YYYY-MM-DD` into numeric components without ever constructing a
 * `Date` from the string (W19). */
export function parseDateOnly(value: string): DateOnlyParts {
  const [year, month, day] = value.split('-').map(Number);
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day)
  ) {
    throw new Error(`Not a YYYY-MM-DD date: "${value}"`);
  }
  return { year, month, day };
}

/** Zero-pads components back into `YYYY-MM-DD` — the inverse of `parseDateOnly`. */
export function toDateOnlyString({ year, month, day }: DateOnlyParts): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** "Jul 16, 2026" — built directly from the parsed components (W19), not `Intl.DateTimeFormat(new Date(...))`. */
export function formatDateOnly(value: string): string {
  const { year, month, day } = parseDateOnly(value);
  return `${MONTH_ABBR[month - 1]} ${String(day)}, ${String(year)}`;
}

/** "July 2026" — the month-grid header label, for any date-only string in that month. */
export function formatMonthLabel(value: string): string {
  const { year, month } = parseDateOnly(value);
  return `${MONTH_NAMES[month - 1]} ${String(year)}`;
}

/** "3:00 PM" — just the time portion of an instant, for a timed event's
 * display (its date is shown separately, by the grid cell or day header). */
export function formatTimeOnly(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(new Date(iso));
}

/**
 * "Jul 16 – Jul 20, 2026" for a multi-day span, labeled inclusive of the end
 * date (plan W15 — `endsAt` is the last day, not exclusive); a single date
 * when start and end are the same day.
 */
export function formatAllDayRange(startsAt: string, endsAt: string): string {
  if (startsAt === endsAt) return formatDateOnly(startsAt);

  const start = parseDateOnly(startsAt);
  const end = parseDateOnly(endsAt);
  const startLabel =
    start.year === end.year ? `${MONTH_ABBR[start.month - 1]} ${String(start.day)}` : formatDateOnly(startsAt);

  return `${startLabel} – ${formatDateOnly(endsAt)}`;
}

/** Today's date, as the browser's local calendar sees it — via `Date`'s
 * numeric getters, never by parsing a string (W19). */
export function todayDateOnly(now: Date = new Date()): string {
  return toDateOnlyString({ year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() });
}

/** The local calendar date a UTC instant falls on for this viewer (day-boundary
 * logic lives here, once, per CLAUDE.md — not duplicated per view). */
export function localDateOnlyOfInstant(iso: string): string {
  const instant = new Date(iso);
  return toDateOnlyString({
    year: instant.getFullYear(),
    month: instant.getMonth() + 1,
    day: instant.getDate(),
  });
}

function daysInMonth(year: number, month: number): number {
  // Day 0 of the *next* month is the last day of `month` — plain numeric
  // Date arithmetic (CLAUDE.md: never `+86400000`), letting the engine
  // normalize the ordinary "day 0" case rather than hand-rolling leap-year math.
  return new Date(year, month, 0).getDate();
}

/** Moves a date-only string by `deltaMonths`, clamping the day into the
 * target month when it doesn't have one that high (e.g. Jan 31 + 1 month ->
 * Feb 28/29, not an overflow into March). Used for the year selector's
 * "corresponding date" rule and for the month stepper. */
export function shiftMonth(value: string, deltaMonths: number): string {
  const { year, month, day } = parseDateOnly(value);
  const totalMonths = (month - 1) + deltaMonths;
  const targetYear = year + Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12 + 1;
  const targetDay = Math.min(day, daysInMonth(targetYear, targetMonth));
  return toDateOnlyString({ year: targetYear, month: targetMonth, day: targetDay });
}

/** Same month and day, in a different year — clamped for Feb 29 (plan
 * "year change -> month and selected day move to the corresponding date"). */
export function withYear(value: string, year: number): string {
  const { month, day } = parseDateOnly(value);
  return toDateOnlyString({ year, month, day: Math.min(day, daysInMonth(year, month)) });
}

export interface MonthGridDay {
  date: string;
  /** False for the leading/trailing days of adjacent months that fill out
   * the 6-week grid. */
  inMonth: boolean;
}

const DAYS_PER_GRID = 42; // 6 weeks, so the grid height never jumps between months

/** Sunday-start 6-week grid for the month containing `value` (any date-only
 * string in that month). Built with the `Date` constructor's numeric
 * (year, month, day) overload, which normalizes out-of-range days across
 * month/DST boundaries correctly — never by adding raw milliseconds. */
export function getMonthGrid(value: string): MonthGridDay[] {
  const { year, month } = parseDateOnly(value);
  const firstOfMonth = new Date(year, month - 1, 1);
  const gridStart = new Date(year, month - 1, 1 - firstOfMonth.getDay());

  const days: MonthGridDay[] = [];
  for (let i = 0; i < DAYS_PER_GRID; i++) {
    const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
    days.push({
      date: toDateOnlyString({ year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() }),
      inMonth: d.getFullYear() === year && d.getMonth() === month - 1,
    });
  }
  return days;
}

/**
 * The events range-query window for a visible month (plan W14): the visible
 * month plus one month on each side, as UTC instants (the range query always
 * takes instants — plan D16 — even though all-day events themselves are
 * date-only). Comfortably under the server's 366-day cap.
 */
export function getEventsFetchWindow(value: string): { start: string; end: string } {
  const { year, month } = parseDateOnly(value);
  const start = new Date(year, month - 2, 1);
  const end = new Date(year, month + 1, 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

// ── Timed-event helpers — W17 ────────────────────────────────────────────

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** An ISO UTC instant, formatted for an `<input type="datetime-local">`'s
 * `value` in the browser's local time (plan W17) — via `Date`'s local
 * getters, not string slicing of the UTC representation. */
export function instantToLocalInputValue(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getFullYear())}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * The reverse: a `datetime-local` input's value, interpreted as the
 * browser's local time and converted to a UTC instant (plan W17). This is
 * the one sanctioned `new Date(string)` call on a non-literal, non-date-only
 * value — `datetime-local` values have no offset, so the browser (and V8)
 * parse them as local time, which is exactly the conversion needed here.
 */
export function localInputValueToInstant(value: string): string {
  return new Date(value).toISOString();
}

/**
 * Whether a `datetime-local` input's live value is complete enough to
 * convert (plan W17 territory, not W19 — this is about a timed value being
 * mid-typed, not a date-only literal). The browser reports an empty or
 * partial string while a keyboard-driven entry is between segments; calling
 * `localInputValueToInstant` on that throws (`Date.toISOString` on an
 * invalid date), which must never happen during render.
 */
export function isCompleteLocalInputValue(value: string): boolean {
  return !Number.isNaN(new Date(value).getTime());
}

// ── Timezone labeling — W18 ──────────────────────────────────────────────

/** e.g. "MDT" — the browser's current timezone abbreviation, for labeling
 * timed-event inputs and displays (plan W18). */
export function getLocalTimeZoneAbbreviation(now: Date = new Date()): string {
  const part = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
    .formatToParts(now)
    .find((p) => p.type === 'timeZoneName');
  return part?.value ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}

const CABIN_TIME_ZONE = 'America/Denver';

/**
 * The same instant formatted in cabin time, or `null` when the viewer is
 * already in `America/Denver` (plan W18) — an admin traveling could
 * otherwise enter "3pm" meaning cabin time and store 3pm in their own zone.
 * Pure display formatting; the stored instant never changes.
 */
export function cabinTimeEcho(iso: string): string | null {
  if (Intl.DateTimeFormat().resolvedOptions().timeZone === CABIN_TIME_ZONE) {
    return null;
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: CABIN_TIME_ZONE,
  }).format(new Date(iso));
}
