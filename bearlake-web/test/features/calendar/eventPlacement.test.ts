import { describe, expect, it } from 'vitest';
import { eventFallsOnDate, eventsOnDate } from '../../../src/features/calendar/eventPlacement.ts';
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

function timedEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    ...allDayEvent(),
    id: 'e2',
    isAllDay: false,
    startsAt: '2026-07-16T20:00:00.000Z',
    endsAt: '2026-07-16T22:00:00.000Z',
    ...overrides,
  };
}

describe('eventFallsOnDate', () => {
  it('places a multi-day all-day event on every day it spans, inclusive of both ends', () => {
    const event = allDayEvent();
    expect(eventFallsOnDate(event, '2026-07-15')).toBe(false);
    expect(eventFallsOnDate(event, '2026-07-16')).toBe(true);
    expect(eventFallsOnDate(event, '2026-07-18')).toBe(true);
    expect(eventFallsOnDate(event, '2026-07-20')).toBe(true);
    expect(eventFallsOnDate(event, '2026-07-21')).toBe(false);
  });

  it('places a timed event on the local calendar date its start instant falls on', () => {
    const event = timedEvent({ startsAt: '2026-07-16T20:00:00.000Z' });
    expect(eventFallsOnDate(event, '2026-07-16')).toBe(true);
    expect(eventFallsOnDate(event, '2026-07-17')).toBe(false);
  });
});

describe('eventsOnDate', () => {
  it('returns every event spanning a given date, all-day and timed alike', () => {
    const multiDay = allDayEvent({ id: 'a', startsAt: '2026-07-16', endsAt: '2026-07-20' });
    const timed = timedEvent({ id: 'b', startsAt: '2026-07-18T20:00:00.000Z' });
    const elsewhere = allDayEvent({ id: 'c', startsAt: '2026-08-01', endsAt: '2026-08-02' });

    expect(eventsOnDate([multiDay, timed, elsewhere], '2026-07-18')).toEqual([multiDay, timed]);
  });
});
