import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MonthGrid } from '../../../src/features/calendar/MonthGrid.tsx';
import type { CalendarEvent } from '../../../src/types/api.ts';

function allDayEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'e1',
    title: 'Family reunion',
    notes: null,
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

describe('MonthGrid', () => {
  it('renders 42 day cells for the visible month', () => {
    render(
      <MonthGrid monthValue="2026-07-01" events={[]} selectedDate="2026-07-01" onSelectDate={vi.fn()} />,
    );
    expect(screen.getAllByRole('button')).toHaveLength(42);
  });

  it('shows a multi-day event on every day it spans', () => {
    const event = allDayEvent({ startsAt: '2026-07-16', endsAt: '2026-07-20' });
    render(
      <MonthGrid monthValue="2026-07-01" events={[event]} selectedDate="2026-07-01" onSelectDate={vi.fn()} />,
    );
    const pills = screen.getAllByText('Family reunion');
    expect(pills).toHaveLength(5); // Jul 16, 17, 18, 19, 20 inclusive
  });

  it('does not show the event outside its span', () => {
    const event = allDayEvent({ startsAt: '2026-07-16', endsAt: '2026-07-20' });
    render(
      <MonthGrid monthValue="2026-07-01" events={[event]} selectedDate="2026-07-01" onSelectDate={vi.fn()} />,
    );
    const day15 = screen.getByLabelText('2026-07-15');
    const day21 = screen.getByLabelText('2026-07-21');
    expect(day15).not.toHaveTextContent('Family reunion');
    expect(day21).not.toHaveTextContent('Family reunion');
  });

  it('calls onSelectDate with the clicked cell\'s date', async () => {
    const user = userEvent.setup();
    const onSelectDate = vi.fn();
    render(
      <MonthGrid monthValue="2026-07-01" events={[]} selectedDate="2026-07-01" onSelectDate={onSelectDate} />,
    );

    await user.click(screen.getByLabelText('2026-07-15'));

    expect(onSelectDate).toHaveBeenCalledExactlyOnceWith('2026-07-15');
  });

  it('marks the selected date as pressed', () => {
    render(
      <MonthGrid monthValue="2026-07-01" events={[]} selectedDate="2026-07-15" onSelectDate={vi.fn()} />,
    );
    expect(screen.getByLabelText('2026-07-15')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('2026-07-16')).toHaveAttribute('aria-pressed', 'false');
  });
});
