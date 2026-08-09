import { useState, type FormEvent } from 'react';
import { useApiClient } from '../../api/context.tsx';
import { useMutation } from '../../api/hooks.ts';
import { ConfirmDialog } from '../../components/ConfirmDialog.tsx';
import { ErrorBanner } from '../../components/ErrorBanner.tsx';
import { Modal } from '../../components/Modal.tsx';
import type { CalendarEvent, CreateEventRequest } from '../../types/api.ts';
import { EVENT_NOTES_MAX, EVENT_TITLE_MAX, EVENT_TITLE_MIN } from '../../types/limits.ts';
import {
  cabinTimeEcho,
  getLocalTimeZoneAbbreviation,
  instantToLocalInputValue,
  isCompleteLocalInputValue,
  localInputValueToInstant,
} from '../../utils/dates.ts';

type Shape =
  | { isAllDay: true; startsAt: string; endsAt: string }
  | { isAllDay: false; startsAt: string; endsAt: string };

/** The held values for both shapes at once, so toggling all-day converts
 * rather than discards whatever the admin already entered (plan step 4). */
function initialShapes(event: CalendarEvent | undefined, defaultDate: string) {
  const allDay =
    event?.isAllDay === true
      ? { start: event.startsAt, end: event.endsAt }
      : { start: defaultDate, end: defaultDate };
  const timed =
    event !== undefined && !event.isAllDay
      ? { start: instantToLocalInputValue(event.startsAt), end: instantToLocalInputValue(event.endsAt) }
      : { start: `${defaultDate}T09:00`, end: `${defaultDate}T17:00` };
  return { allDay, timed };
}

/**
 * One form for create and edit (plan step 4). Toggling all-day swaps between
 * `<input type="date">` and `<input type="datetime-local">`, converting the
 * held values (date <-> local datetime via string slicing, never a `Date`
 * construction from a date-only string — W19) so the submitted shape always
 * matches `isAllDay`; mixing shapes is a server 400.
 *
 * Delete lives here, in edit mode only (CLAUDE.md), behind a confirmation —
 * same pattern as EditUserModal's deactivate step.
 */
export function EventFormModal({
  event,
  defaultDate,
  onClose,
  onSaved,
  onDeleted,
}: {
  event?: CalendarEvent | undefined;
  defaultDate: string;
  onClose: () => void;
  onSaved: (event: CalendarEvent) => void;
  onDeleted: () => void;
}) {
  const api = useApiClient();
  const { allDay: initialAllDay, timed: initialTimed } = initialShapes(event, defaultDate);

  const [title, setTitle] = useState(event?.title ?? '');
  const [notes, setNotes] = useState(event?.notes ?? '');
  const [isAllDay, setIsAllDay] = useState(event?.isAllDay ?? true);
  const [allDayStart, setAllDayStart] = useState(initialAllDay.start);
  const [allDayEnd, setAllDayEnd] = useState(initialAllDay.end);
  const [timedStart, setTimedStart] = useState(initialTimed.start);
  const [timedEnd, setTimedEnd] = useState(initialTimed.end);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const { mutate, loading, error } = useMutation((payload: CreateEventRequest) =>
    event === undefined ? api.createEvent(payload) : api.updateEvent(event.id, payload),
  );
  const deleteMutation = useMutation(api.deleteEvent);

  function toggleAllDay(next: boolean): void {
    if (next) {
      // datetime-local values are already "YYYY-MM-DDTHH:mm" — the date is
      // just the first 10 characters, no Date construction needed.
      setAllDayStart(timedStart.slice(0, 10));
      setAllDayEnd(timedEnd.slice(0, 10));
    } else {
      setTimedStart(`${allDayStart}T00:00`);
      setTimedEnd(`${allDayEnd}T00:00`);
    }
    setIsAllDay(next);
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setValidationError(null);

    const trimmedTitle = title.trim();
    if (trimmedTitle.length < EVENT_TITLE_MIN || trimmedTitle.length > EVENT_TITLE_MAX) {
      setValidationError(`Title must be between ${String(EVENT_TITLE_MIN)} and ${String(EVENT_TITLE_MAX)} characters.`);
      return;
    }
    const trimmedNotes = notes.trim();
    if (trimmedNotes.length > EVENT_NOTES_MAX) {
      setValidationError(`Notes must be ${String(EVENT_NOTES_MAX)} characters or fewer.`);
      return;
    }

    const shape: Shape = isAllDay
      ? { isAllDay: true, startsAt: allDayStart, endsAt: allDayEnd }
      : {
          isAllDay: false,
          startsAt: localInputValueToInstant(timedStart),
          endsAt: localInputValueToInstant(timedEnd),
        };

    if (isAllDay ? shape.startsAt > shape.endsAt : shape.startsAt >= shape.endsAt) {
      setValidationError(
        isAllDay
          ? 'The end date must not be before the start date.'
          : 'The end time must be after the start time.',
      );
      return;
    }

    const payload: CreateEventRequest = {
      ...shape,
      title: trimmedTitle,
      notes: trimmedNotes.length > 0 ? trimmedNotes : null,
    };

    try {
      const result = await mutate(payload);
      onSaved(result);
    } catch {
      // error state is already recorded on the mutation; nothing else to do here.
    }
  }

  async function handleConfirmDelete(): Promise<void> {
    if (event === undefined) return;
    setConfirmingDelete(false);
    try {
      await deleteMutation.mutate(event.id);
      onDeleted();
    } catch {
      // error state is already recorded on the mutation; nothing else to do here.
    }
  }

  if (confirmingDelete) {
    return (
      <ConfirmDialog
        title="Delete this event?"
        message="This cannot be undone."
        confirmLabel="Delete"
        danger
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => setConfirmingDelete(false)}
      />
    );
  }

  const tzAbbr = getLocalTimeZoneAbbreviation();
  // A datetime-local input reports an empty or partial value while a
  // keyboard-driven entry is mid-segment — never convert that (it would
  // throw on render, not just show a stale echo).
  const startEcho =
    !isAllDay && isCompleteLocalInputValue(timedStart)
      ? cabinTimeEcho(localInputValueToInstant(timedStart))
      : null;
  const endEcho =
    !isAllDay && isCompleteLocalInputValue(timedEnd)
      ? cabinTimeEcho(localInputValueToInstant(timedEnd))
      : null;

  return (
    <Modal title={event === undefined ? 'New event' : 'Edit event'} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void handleSubmit(e)}>
        <div className="field">
          <label htmlFor="event-title">Title</label>
          <input id="event-title" type="text" required value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="event-notes">Notes</label>
          <textarea id="event-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          <p className="field-hint">
            {notes.trim().length} / {EVENT_NOTES_MAX}
          </p>
        </div>
        <label className="row">
          <input
            type="checkbox"
            style={{ width: 'auto' }}
            checked={isAllDay}
            onChange={(e) => toggleAllDay(e.target.checked)}
          />
          All-day
        </label>

        {isAllDay ? (
          <>
            <div className="field">
              <label htmlFor="event-start-date">Starts</label>
              <input
                id="event-start-date"
                type="date"
                required
                value={allDayStart}
                onChange={(e) => setAllDayStart(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="event-end-date">Ends</label>
              <input
                id="event-end-date"
                type="date"
                required
                value={allDayEnd}
                onChange={(e) => setAllDayEnd(e.target.value)}
              />
            </div>
          </>
        ) : (
          <>
            <div className="field">
              <label htmlFor="event-start-time">Starts ({tzAbbr})</label>
              <input
                id="event-start-time"
                type="datetime-local"
                required
                value={timedStart}
                onChange={(e) => setTimedStart(e.target.value)}
              />
              {startEcho !== null && <p className="field-hint">{startEcho} cabin time</p>}
            </div>
            <div className="field">
              <label htmlFor="event-end-time">Ends ({tzAbbr})</label>
              <input
                id="event-end-time"
                type="datetime-local"
                required
                value={timedEnd}
                onChange={(e) => setTimedEnd(e.target.value)}
              />
              {endEcho !== null && <p className="field-hint">{endEcho} cabin time</p>}
            </div>
          </>
        )}

        {validationError !== null && (
          <p className="error-banner" role="alert">
            {validationError}
          </p>
        )}
        {error !== null && <ErrorBanner error={error} />}
        {deleteMutation.error !== null && <ErrorBanner error={deleteMutation.error} />}

        <div className="row row--between">
          <div className="row">
            <button type="submit" className="btn btn--primary" disabled={loading}>
              {loading ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="btn btn--ghost" onClick={onClose}>
              Cancel
            </button>
          </div>
          {event !== undefined && (
            <button
              type="button"
              className="btn btn--danger"
              onClick={() => setConfirmingDelete(true)}
              disabled={deleteMutation.loading}
            >
              Delete
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
