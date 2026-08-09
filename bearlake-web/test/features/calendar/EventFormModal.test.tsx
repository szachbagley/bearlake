import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClientProvider, type ApiClient } from '../../../src/api/context.tsx';
import { EventFormModal } from '../../../src/features/calendar/EventFormModal.tsx';
import type { CalendarEvent, CreateEventRequest } from '../../../src/types/api.ts';
import { createFakeApiClient } from '../../auth/testUtils.tsx';

function baseEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'e1',
    title: 'Existing event',
    notes: 'Some notes',
    startsAt: '2026-07-16',
    endsAt: '2026-07-20',
    isAllDay: true,
    createdBy: 'u1',
    creatorDisplayName: 'Zach',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderModal(client: ApiClient, props: Partial<ComponentProps<typeof EventFormModal>> = {}) {
  return render(
    <ApiClientProvider client={client}>
      <EventFormModal
        defaultDate="2026-07-16"
        onClose={vi.fn()}
        onSaved={vi.fn()}
        onDeleted={vi.fn()}
        {...props}
      />
    </ApiClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('EventFormModal — all-day round-trip (never shifts a day)', () => {
  it.each(['Etc/GMT-13', 'Etc/GMT+11', 'America/Denver', 'UTC'])(
    'submits the exact date-only strings entered, unmodified, at TZ=%s',
    async (tz) => {
      vi.stubEnv('TZ', tz);
      const createEvent = vi.fn().mockResolvedValue(baseEvent());
      const client = createFakeApiClient({ createEvent });
      const user = userEvent.setup();

      renderModal(client);
      await user.type(screen.getByLabelText('Title'), 'Cabin stay');
      fireEvent.change(screen.getByLabelText('Starts'), { target: { value: '2026-07-16' } });
      fireEvent.change(screen.getByLabelText('Ends'), { target: { value: '2026-07-20' } });
      await user.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => expect(createEvent).toHaveBeenCalledOnce());
      const payload = createEvent.mock.calls[0]?.[0] as CreateEventRequest;
      expect(payload).toEqual({
        isAllDay: true,
        title: 'Cabin stay',
        notes: null,
        startsAt: '2026-07-16',
        endsAt: '2026-07-20',
      });
    },
  );
});

describe('EventFormModal — timed event UTC serialization across both 2026 DST transitions', () => {
  it('spring-forward: 2026-03-08 3:00pm Denver serializes to the correct MDT offset', async () => {
    vi.stubEnv('TZ', 'America/Denver');
    const createEvent = vi.fn().mockResolvedValue(baseEvent({ isAllDay: false }));
    const client = createFakeApiClient({ createEvent });
    const user = userEvent.setup();

    renderModal(client, { defaultDate: '2026-03-08' });
    await user.type(screen.getByLabelText('Title'), 'Spring event');
    await user.click(screen.getByRole('checkbox')); // toggle off all-day
    fireEvent.change(screen.getByLabelText(/^Starts/), { target: { value: '2026-03-08T15:00' } });
    fireEvent.change(screen.getByLabelText(/^Ends/), { target: { value: '2026-03-08T16:00' } });
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(createEvent).toHaveBeenCalledOnce());
    const payload = createEvent.mock.calls[0]?.[0] as CreateEventRequest;
    expect(payload.startsAt).toBe('2026-03-08T21:00:00.000Z'); // MDT, UTC-6
    expect(payload.endsAt).toBe('2026-03-08T22:00:00.000Z');
  });

  it('fall-back: 2026-11-01 3:00pm Denver serializes to the correct MST offset', async () => {
    vi.stubEnv('TZ', 'America/Denver');
    const createEvent = vi.fn().mockResolvedValue(baseEvent({ isAllDay: false }));
    const client = createFakeApiClient({ createEvent });
    const user = userEvent.setup();

    renderModal(client, { defaultDate: '2026-11-01' });
    await user.type(screen.getByLabelText('Title'), 'Fall event');
    await user.click(screen.getByRole('checkbox'));
    fireEvent.change(screen.getByLabelText(/^Starts/), { target: { value: '2026-11-01T15:00' } });
    fireEvent.change(screen.getByLabelText(/^Ends/), { target: { value: '2026-11-01T16:00' } });
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(createEvent).toHaveBeenCalledOnce());
    const payload = createEvent.mock.calls[0]?.[0] as CreateEventRequest;
    expect(payload.startsAt).toBe('2026-11-01T22:00:00.000Z'); // MST, UTC-7
    expect(payload.endsAt).toBe('2026-11-01T23:00:00.000Z');
  });
});

describe('EventFormModal — toggling all-day rewrites the payload shape', () => {
  it('converts held timed values to date-only when switched to all-day before submit', async () => {
    const createEvent = vi.fn().mockResolvedValue(baseEvent());
    const client = createFakeApiClient({ createEvent });
    const user = userEvent.setup();

    renderModal(client, { defaultDate: '2026-07-16' });
    await user.type(screen.getByLabelText('Title'), 'Converted event');
    await user.click(screen.getByRole('checkbox')); // off: now timed
    fireEvent.change(screen.getByLabelText(/^Starts/), { target: { value: '2026-07-18T09:30' } });
    fireEvent.change(screen.getByLabelText(/^Ends/), { target: { value: '2026-07-19T17:00' } });
    await user.click(screen.getByRole('checkbox')); // back on: all-day again

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(createEvent).toHaveBeenCalledOnce());
    const payload = createEvent.mock.calls[0]?.[0] as CreateEventRequest;
    expect(payload.isAllDay).toBe(true);
    expect(payload.startsAt).toBe('2026-07-18');
    expect(payload.endsAt).toBe('2026-07-19');
  });

  it('converts held all-day values to timed (midnight) when switched to timed before submit', async () => {
    const createEvent = vi.fn().mockResolvedValue(baseEvent({ isAllDay: false }));
    const client = createFakeApiClient({ createEvent });
    const user = userEvent.setup();
    vi.stubEnv('TZ', 'America/Denver');

    renderModal(client, { defaultDate: '2026-07-16' });
    await user.type(screen.getByLabelText('Title'), 'Converted the other way');
    fireEvent.change(screen.getByLabelText('Starts'), { target: { value: '2026-07-16' } });
    fireEvent.change(screen.getByLabelText('Ends'), { target: { value: '2026-07-18' } });
    await user.click(screen.getByRole('checkbox')); // off: now timed, converted from the dates above

    expect(screen.getByLabelText(/^Starts/)).toHaveValue('2026-07-16T00:00');
    expect(screen.getByLabelText(/^Ends/)).toHaveValue('2026-07-18T00:00');
  });
});

describe('EventFormModal — regression: a mid-typed datetime-local value must not crash the render', () => {
  it('renders without throwing when a timed field reports an empty value (browser behavior while typing)', async () => {
    const client = createFakeApiClient();
    const user = userEvent.setup();

    renderModal(client);
    await user.click(screen.getByRole('checkbox')); // switch to timed
    // A native datetime-local input reports "" while a keyboard-driven entry
    // is between segments — this must render gracefully (no cabin-time echo),
    // not throw RangeError: Invalid time value from Date#toISOString.
    fireEvent.change(screen.getByLabelText(/^Starts/), { target: { value: '' } });

    expect(screen.getByLabelText(/^Starts/)).toHaveValue('');
    expect(screen.queryByText(/cabin time/)).not.toBeInTheDocument();
  });
});

describe('EventFormModal — validation', () => {
  it('rejects an empty title client-side without calling the API', async () => {
    const createEvent = vi.fn();
    const client = createFakeApiClient({ createEvent });
    const user = userEvent.setup();

    renderModal(client);
    fireEvent.change(screen.getByLabelText('Starts'), { target: { value: '2026-07-16' } });
    fireEvent.change(screen.getByLabelText('Ends'), { target: { value: '2026-07-16' } });
    // jsdom enforces the native `required` attribute on submit, which is
    // exactly the boundary this test wants: an empty title never reaches
    // the handler at all.
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(createEvent).not.toHaveBeenCalled();
  });

  it('rejects an all-day end date before the start date', async () => {
    const createEvent = vi.fn();
    const client = createFakeApiClient({ createEvent });
    const user = userEvent.setup();

    renderModal(client);
    await user.type(screen.getByLabelText('Title'), 'Backwards');
    fireEvent.change(screen.getByLabelText('Starts'), { target: { value: '2026-07-20' } });
    fireEvent.change(screen.getByLabelText('Ends'), { target: { value: '2026-07-16' } });
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('The end date must not be before the start date.')).toBeInTheDocument();
    expect(createEvent).not.toHaveBeenCalled();
  });

  it('rejects a timed end time that is not after the start time', async () => {
    const createEvent = vi.fn();
    const client = createFakeApiClient({ createEvent });
    const user = userEvent.setup();

    renderModal(client);
    await user.type(screen.getByLabelText('Title'), 'Same time');
    await user.click(screen.getByRole('checkbox'));
    fireEvent.change(screen.getByLabelText(/^Starts/), { target: { value: '2026-07-16T15:00' } });
    fireEvent.change(screen.getByLabelText(/^Ends/), { target: { value: '2026-07-16T15:00' } });
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('The end time must be after the start time.')).toBeInTheDocument();
    expect(createEvent).not.toHaveBeenCalled();
  });

  it('allows an all-day event where start equals end (a single day)', async () => {
    const createEvent = vi.fn().mockResolvedValue(baseEvent());
    const client = createFakeApiClient({ createEvent });
    const user = userEvent.setup();

    renderModal(client);
    await user.type(screen.getByLabelText('Title'), 'One day');
    fireEvent.change(screen.getByLabelText('Starts'), { target: { value: '2026-07-16' } });
    fireEvent.change(screen.getByLabelText('Ends'), { target: { value: '2026-07-16' } });
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(createEvent).toHaveBeenCalledOnce());
  });
});

describe('EventFormModal — edit mode', () => {
  it('pre-populates fields from the existing all-day event', () => {
    const client = createFakeApiClient();
    renderModal(client, { event: baseEvent() });

    expect(screen.getByLabelText('Title')).toHaveValue('Existing event');
    expect(screen.getByLabelText('Notes')).toHaveValue('Some notes');
    expect(screen.getByLabelText('Starts')).toHaveValue('2026-07-16');
    expect(screen.getByLabelText('Ends')).toHaveValue('2026-07-20');
  });

  it('pre-populates fields from an existing timed event in local time', () => {
    vi.stubEnv('TZ', 'America/Denver');
    const timed = baseEvent({
      isAllDay: false,
      startsAt: '2026-07-16T20:00:00.000Z',
      endsAt: '2026-07-16T22:00:00.000Z',
    });
    const client = createFakeApiClient();
    renderModal(client, { event: timed });

    expect(screen.getByLabelText(/^Starts/)).toHaveValue('2026-07-16T14:00'); // MDT, UTC-6
    expect(screen.getByLabelText(/^Ends/)).toHaveValue('2026-07-16T16:00');
  });

  it('shows a Delete button only in edit mode', () => {
    const client = createFakeApiClient();
    const { rerender } = renderModal(client, { event: baseEvent() });
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();

    rerender(
      <ApiClientProvider client={client}>
        <EventFormModal defaultDate="2026-07-16" onClose={vi.fn()} onSaved={vi.fn()} onDeleted={vi.fn()} />
      </ApiClientProvider>,
    );
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('deletes only after confirmation', async () => {
    const deleteEvent = vi.fn().mockResolvedValue(undefined);
    const client = createFakeApiClient({ deleteEvent });
    const onDeleted = vi.fn();
    const user = userEvent.setup();

    renderModal(client, { event: baseEvent(), onDeleted });
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(deleteEvent).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(deleteEvent).toHaveBeenCalledExactlyOnceWith('e1'));
    expect(onDeleted).toHaveBeenCalledOnce();
  });

  it('sends the update to updateEvent, not createEvent', async () => {
    const updateEvent = vi.fn().mockResolvedValue(baseEvent({ title: 'Renamed' }));
    const client = createFakeApiClient({ updateEvent });
    const user = userEvent.setup();

    renderModal(client, { event: baseEvent() });
    const title = screen.getByLabelText('Title');
    await user.clear(title);
    await user.type(title, 'Renamed');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(updateEvent).toHaveBeenCalledExactlyOnceWith('e1', {
        isAllDay: true,
        title: 'Renamed',
        notes: 'Some notes',
        startsAt: '2026-07-16',
        endsAt: '2026-07-20',
      }),
    );
    expect(client.createEvent).not.toHaveBeenCalled();
  });
});
