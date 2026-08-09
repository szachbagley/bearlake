import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiClientProvider, type ApiClient } from '../../../src/api/context.tsx';
import { CalendarPage } from '../../../src/features/calendar/CalendarPage.tsx';
import type { ListEventsQuery } from '../../../src/types/api.ts';
import {
  formatDateOnly,
  formatMonthLabel,
  getEventsFetchWindow,
  parseDateOnly,
  shiftMonth,
  todayDateOnly,
  toDateOnlyString,
} from '../../../src/utils/dates.ts';
import { createFakeApiClient } from '../../auth/testUtils.tsx';

function renderPage(client: ApiClient) {
  return render(
    <ApiClientProvider client={client}>
      <CalendarPage />
    </ApiClientProvider>,
  );
}

describe('CalendarPage — selection rules', () => {
  it('defaults the selected day to today on first load', async () => {
    const client = createFakeApiClient({ listEvents: () => Promise.resolve({ events: [] }) });
    renderPage(client);

    await waitFor(() => expect(screen.getByText(formatDateOnly(todayDateOnly()))).toBeInTheDocument());
  });

  it('resets the selected day to the 1st of the month when the month changes', async () => {
    const client = createFakeApiClient({ listEvents: () => Promise.resolve({ events: [] }) });
    const user = userEvent.setup();
    renderPage(client);

    await waitFor(() => expect(screen.getByText(formatDateOnly(todayDateOnly()))).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Next month' }));

    const nextMonthFirst = shiftMonth(
      toDateOnlyString({ ...parseDateOnly(todayDateOnly()), day: 1 }),
      1,
    );
    await waitFor(() => expect(screen.getByText(formatDateOnly(nextMonthFirst))).toBeInTheDocument());
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(formatMonthLabel(nextMonthFirst));
  });

  it('moves the selected date to the corresponding day in a newly selected year', async () => {
    const client = createFakeApiClient({ listEvents: () => Promise.resolve({ events: [] }) });
    const user = userEvent.setup();
    renderPage(client);

    await waitFor(() => expect(screen.getByText(formatDateOnly(todayDateOnly()))).toBeInTheDocument());
    const { year, month, day } = parseDateOnly(todayDateOnly());
    const targetYear = year + 1;

    await user.selectOptions(screen.getByLabelText('Year'), String(targetYear));

    const expected = toDateOnlyString({ year: targetYear, month, day });
    await waitFor(() => expect(screen.getByText(formatDateOnly(expected))).toBeInTheDocument());
  });
});

describe('CalendarPage — range query', () => {
  it('fetches with the visible-month ± 1 window, well within 366 days', async () => {
    const listEvents = vi.fn().mockResolvedValue({ events: [] });
    const client = createFakeApiClient({ listEvents });
    renderPage(client);

    await waitFor(() => expect(listEvents).toHaveBeenCalledOnce());
    const query = listEvents.mock.calls[0]?.[0] as ListEventsQuery;
    const expectedWindow = getEventsFetchWindow(todayDateOnly());
    expect(query).toEqual(expectedWindow);

    const spanDays =
      (new Date(query.end).getTime() - new Date(query.start).getTime()) / (24 * 60 * 60 * 1000);
    expect(spanDays).toBeLessThanOrEqual(366);
  });

  it('refetches with a new window when the month changes', async () => {
    const listEvents = vi.fn().mockResolvedValue({ events: [] });
    const client = createFakeApiClient({ listEvents });
    const user = userEvent.setup();
    renderPage(client);

    await waitFor(() => expect(listEvents).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: 'Next month' }));

    await waitFor(() => expect(listEvents).toHaveBeenCalledTimes(2));
    const firstQuery = listEvents.mock.calls[0]?.[0] as ListEventsQuery;
    const secondQuery = listEvents.mock.calls[1]?.[0] as ListEventsQuery;
    expect(secondQuery.start).not.toBe(firstQuery.start);
  });

  it('does not refetch when selecting a different day within the same visible month', async () => {
    const listEvents = vi.fn().mockResolvedValue({ events: [] });
    const client = createFakeApiClient({ listEvents });
    const user = userEvent.setup();
    renderPage(client);

    await waitFor(() => expect(listEvents).toHaveBeenCalledTimes(1));
    const today = parseDateOnly(todayDateOnly());
    // A day guaranteed to exist and differ from today: day 1, or day 2 on
    // the off chance today already is the 1st.
    const otherDay = toDateOnlyString({ ...today, day: today.day === 1 ? 2 : 1 });

    await user.click(screen.getByLabelText(otherDay));

    expect(listEvents).toHaveBeenCalledTimes(1);
  });
});
