import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError } from '../../api/client.ts';
import { useApiClient } from '../../api/context.tsx';
import { ErrorBanner } from '../../components/ErrorBanner.tsx';
import { Spinner } from '../../components/Spinner.tsx';
import type { CalendarEvent } from '../../types/api.ts';
import {
  formatMonthLabel,
  getEventsFetchWindow,
  parseDateOnly,
  shiftMonth,
  todayDateOnly,
  toDateOnlyString,
  withYear,
} from '../../utils/dates.ts';
import { DayDetail } from './DayDetail.tsx';
import { EventFormModal } from './EventFormModal.tsx';
import { MonthGrid } from './MonthGrid.tsx';

type FormState = 'closed' | 'create' | CalendarEvent;

const YEAR_RANGE = 5;

/**
 * Selection rules, followed exactly (CLAUDE.md): the selected day defaults
 * to today on first load; changing the month resets the selected day to the
 * 1st of that month; changing the year moves the month/day to the
 * corresponding date in the new year (clamped for Feb 29 — see
 * utils/dates.ts's `withYear`).
 */
export function CalendarPage() {
  const api = useApiClient();
  const [selectedDate, setSelectedDate] = useState(() => todayDateOnly());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [formState, setFormState] = useState<FormState>('closed');

  const { year, month } = parseDateOnly(selectedDate);
  // The fetch window depends only on the visible month (plan W14) — this key
  // is the effect dependency so selecting a different day within the same
  // month never triggers a refetch, only navigating to a new month does.
  const monthKey = `${String(year)}-${String(month)}`;

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { start, end } = getEventsFetchWindow(selectedDate);
      const result = await api.listEvents({ start, end });
      setEvents(result.events);
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      setError(err);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally keyed on monthKey, not selectedDate (see comment above)
  }, [api, monthKey]);

  useEffect(() => {
    // Same documented data-fetching pattern as api/hooks.ts's useQuery.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadEvents();
  }, [loadEvents]);

  function goToMonth(delta: number): void {
    setSelectedDate((current) => {
      const firstOfMonth = toDateOnlyString({ ...parseDateOnly(current), day: 1 });
      return shiftMonth(firstOfMonth, delta);
    });
  }

  function goToYear(newYear: number): void {
    setSelectedDate((current) => withYear(current, newYear));
  }

  function handleSaved(): void {
    setFormState('closed');
    void loadEvents();
  }

  function handleDeleted(): void {
    setFormState('closed');
    void loadEvents();
  }

  const years = useMemo(() => {
    const base = new Date().getFullYear();
    return Array.from({ length: YEAR_RANGE * 2 + 1 }, (_, i) => base - YEAR_RANGE + i);
  }, []);

  return (
    <div className="stack">
      <div className="row row--between">
        <div className="row">
          <button type="button" className="btn btn--ghost" aria-label="Previous month" onClick={() => goToMonth(-1)}>
            ‹
          </button>
          <h1 style={{ minWidth: '12rem', textAlign: 'center', margin: 0 }}>{formatMonthLabel(selectedDate)}</h1>
          <button type="button" className="btn btn--ghost" aria-label="Next month" onClick={() => goToMonth(1)}>
            ›
          </button>
          <select aria-label="Year" value={year} onChange={(e) => goToYear(Number(e.target.value))}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="btn btn--primary" onClick={() => setFormState('create')}>
          + New event
        </button>
      </div>

      {error !== null && <ErrorBanner error={error} />}

      {loading ? (
        <Spinner label="Loading events…" />
      ) : (
        <MonthGrid
          monthValue={selectedDate}
          events={events}
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
        />
      )}

      <DayDetail
        date={selectedDate}
        events={events}
        onCreate={() => setFormState('create')}
        onSelectEvent={(event) => setFormState(event)}
      />

      {formState !== 'closed' && (
        <EventFormModal
          event={formState === 'create' ? undefined : formState}
          defaultDate={selectedDate}
          onClose={() => setFormState('closed')}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
        />
      )}
    </div>
  );
}
