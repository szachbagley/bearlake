import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DayDetail } from '../../../src/features/calendar/DayDetail.tsx';
import type { CalendarEvent } from '../../../src/types/api.ts';

function baseEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'e1',
    title: 'Event',
    notes: null,
    startsAt: '2026-07-16',
    endsAt: '2026-07-16',
    isAllDay: true,
    createdBy: 'u1',
    creatorDisplayName: 'Zach',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('DayDetail', () => {
  it('shows an empty-state prompt that opens create when there are no events', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(<DayDetail date="2026-07-16" events={[]} onCreate={onCreate} onSelectEvent={vi.fn()} />);

    await user.click(screen.getByText('No events yet — click to add one.'));

    expect(onCreate).toHaveBeenCalledOnce();
  });

  it('lists all-day events above timed events', () => {
    const allDay = baseEvent({ id: 'a', title: 'All-day event', isAllDay: true });
    const timed = baseEvent({
      id: 'b',
      title: 'Timed event',
      isAllDay: false,
      startsAt: '2026-07-16T20:00:00.000Z',
      endsAt: '2026-07-16T22:00:00.000Z',
    });

    render(<DayDetail date="2026-07-16" events={[timed, allDay]} onCreate={vi.fn()} onSelectEvent={vi.fn()} />);

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('All-day event');
    expect(items[1]).toHaveTextContent('Timed event');
  });

  it('sorts multiple timed events chronologically', () => {
    const later = baseEvent({
      id: 'b',
      title: 'Later',
      isAllDay: false,
      startsAt: '2026-07-16T22:00:00.000Z',
      endsAt: '2026-07-16T23:00:00.000Z',
    });
    const earlier = baseEvent({
      id: 'a',
      title: 'Earlier',
      isAllDay: false,
      startsAt: '2026-07-16T14:00:00.000Z',
      endsAt: '2026-07-16T15:00:00.000Z',
    });

    render(<DayDetail date="2026-07-16" events={[later, earlier]} onCreate={vi.fn()} onSelectEvent={vi.fn()} />);

    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Earlier');
    expect(items[1]).toHaveTextContent('Later');
  });

  it('calls onSelectEvent when an event is clicked', async () => {
    const user = userEvent.setup();
    const onSelectEvent = vi.fn();
    const event = baseEvent();
    render(<DayDetail date="2026-07-16" events={[event]} onCreate={vi.fn()} onSelectEvent={onSelectEvent} />);

    await user.click(screen.getByText('Event'));

    expect(onSelectEvent).toHaveBeenCalledExactlyOnceWith(event);
  });

  it('only shows events that fall on the given date', () => {
    const here = baseEvent({ id: 'a', title: 'Here', startsAt: '2026-07-16', endsAt: '2026-07-16' });
    const elsewhere = baseEvent({ id: 'b', title: 'Elsewhere', startsAt: '2026-07-17', endsAt: '2026-07-17' });

    render(<DayDetail date="2026-07-16" events={[here, elsewhere]} onCreate={vi.fn()} onSelectEvent={vi.fn()} />);

    expect(screen.getByText('Here')).toBeInTheDocument();
    expect(screen.queryByText('Elsewhere')).not.toBeInTheDocument();
  });
});
