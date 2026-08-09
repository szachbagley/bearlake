import type { CalendarEvent } from '../../types/api.ts';
import { localDateOnlyOfInstant } from '../../utils/dates.ts';

/**
 * Which day-only string an event "belongs to" for grid/day-detail placement
 * (CLAUDE.md: day-boundary logic lives in one shared place). All-day events
 * compare their date-only bounds lexicographically (W19); a timed event is
 * placed on the local calendar date its `startsAt` instant falls on for this
 * viewer — the schema doesn't allow a timed event to span multiple days.
 */
export function eventFallsOnDate(event: CalendarEvent, date: string): boolean {
  if (event.isAllDay) {
    return event.startsAt <= date && date <= event.endsAt;
  }
  return localDateOnlyOfInstant(event.startsAt) === date;
}

export function eventsOnDate(events: CalendarEvent[], date: string): CalendarEvent[] {
  return events.filter((event) => eventFallsOnDate(event, date));
}
