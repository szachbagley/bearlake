import type { CalendarEvent } from '../../types/api.ts';
import { formatTimeOnly, getMonthGrid, todayDateOnly } from '../../utils/dates.ts';
import { eventsOnDate } from './eventPlacement.ts';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Sunday-start month grid (plan step 2). All-day/multi-day events are
 * listed before timed ones in each cell, matching the day detail panel
 * below it. */
export function MonthGrid({
  monthValue,
  events,
  selectedDate,
  onSelectDate,
}: {
  monthValue: string;
  events: CalendarEvent[];
  selectedDate: string;
  onSelectDate: (date: string) => void;
}) {
  const grid = getMonthGrid(monthValue);
  const today = todayDateOnly();

  return (
    <div className="month-grid">
      <div className="month-grid-header">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="month-grid-weekday">
            {label}
          </div>
        ))}
      </div>
      <div className="month-grid-body">
        {grid.map((cell) => {
          const dayEvents = eventsOnDate(events, cell.date);
          const allDay = dayEvents.filter((e) => e.isAllDay);
          const timed = dayEvents.filter((e) => !e.isAllDay);
          const isSelected = cell.date === selectedDate;
          const isToday = cell.date === today;
          const dayNumber = cell.date.slice(-2).replace(/^0/, '');

          return (
            <button
              type="button"
              key={cell.date}
              className={`month-grid-cell${isSelected ? ' month-grid-cell--selected' : ''}${
                cell.inMonth ? '' : ' month-grid-cell--outside'
              }`}
              onClick={() => onSelectDate(cell.date)}
              aria-pressed={isSelected}
              aria-label={cell.date}
            >
              <span className={isToday ? 'month-grid-day-number month-grid-day-number--today' : 'month-grid-day-number'}>
                {dayNumber}
              </span>
              <span className="stack" style={{ gap: 2 }}>
                {allDay.map((event) => (
                  <span key={event.id} className="month-grid-pill month-grid-pill--all-day">
                    {event.title}
                  </span>
                ))}
                {timed.map((event) => (
                  <span key={event.id} className="month-grid-pill">
                    {formatTimeOnly(event.startsAt)} {event.title}
                  </span>
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
