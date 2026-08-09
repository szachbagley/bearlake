import type { CalendarEvent } from '../../types/api.ts';
import { formatAllDayRange, formatDateOnly, formatTimeOnly } from '../../utils/dates.ts';
import { eventsOnDate } from './eventPlacement.ts';

/**
 * The selected date's events (plan step 3): all-day/multi-day events pinned
 * above timed ones, timed events sorted chronologically. Tapping empty
 * space opens Create Event pre-populated with this date (CLAUDE.md);
 * tapping an existing event opens it for editing — every viewer of this
 * admin-only tool is an admin, so there's no separate read-only detail view
 * the way iOS needs for non-owning members (plan step 6).
 */
export function DayDetail({
  date,
  events,
  onCreate,
  onSelectEvent,
}: {
  date: string;
  events: CalendarEvent[];
  onCreate: () => void;
  onSelectEvent: (event: CalendarEvent) => void;
}) {
  const dayEvents = eventsOnDate(events, date);
  const allDay = dayEvents.filter((e) => e.isAllDay);
  const timed = [...dayEvents.filter((e) => !e.isAllDay)].sort((a, b) =>
    a.startsAt.localeCompare(b.startsAt),
  );

  return (
    <div className="card stack">
      <div className="row row--between">
        <h2>{formatDateOnly(date)}</h2>
        <button type="button" className="btn btn--primary" onClick={onCreate}>
          + New event
        </button>
      </div>

      {dayEvents.length === 0 ? (
        <button
          type="button"
          className="btn day-detail-empty"
          onClick={onCreate}
        >
          No events yet — click to add one.
        </button>
      ) : (
        <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {allDay.map((event) => (
            <li key={event.id}>
              <button type="button" className="day-detail-event" onClick={() => onSelectEvent(event)}>
                <strong>{event.title}</strong>
                <span className="text-muted">
                  {' '}
                  · {formatAllDayRange(event.startsAt, event.endsAt)} · {event.creatorDisplayName}
                </span>
              </button>
            </li>
          ))}
          {timed.map((event) => (
            <li key={event.id}>
              <button type="button" className="day-detail-event" onClick={() => onSelectEvent(event)}>
                <strong>{formatTimeOnly(event.startsAt)}</strong> {event.title}
                <span className="text-muted"> · {event.creatorDisplayName}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
