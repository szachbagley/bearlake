import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiClientProvider, type ApiClient } from '../../../src/api/context.tsx';
import { ApiError } from '../../../src/api/client.ts';
import { AnnouncementsPage } from '../../../src/features/announcements/AnnouncementsPage.tsx';
import type { Announcement, AnnouncementPage } from '../../../src/types/api.ts';
import { ANNOUNCEMENT_BODY_MAX } from '../../../src/types/limits.ts';
import { createFakeApiClient } from '../../auth/testUtils.tsx';

function announcement(overrides: Partial<Announcement> = {}): Announcement {
  return {
    id: 'a1',
    body: 'The dock light is out.',
    postedAt: '2026-07-01T12:00:00.000Z',
    createdBy: 'u1',
    createdAt: '2026-07-01T12:00:00.000Z',
    updatedAt: '2026-07-01T12:00:00.000Z',
    ...overrides,
  };
}

function renderPage(client: ApiClient) {
  return render(
    <ApiClientProvider client={client}>
      <AnnouncementsPage />
    </ApiClientProvider>,
  );
}

describe('AnnouncementsPage', () => {
  it('renders the first page of items', async () => {
    const page: AnnouncementPage = { items: [announcement()], nextCursor: null };
    const client = createFakeApiClient({ listAnnouncements: () => Promise.resolve(page) });

    renderPage(client);

    await waitFor(() => expect(screen.getByText('The dock light is out.')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('shows an empty state when there are no announcements', async () => {
    const client = createFakeApiClient({
      listAnnouncements: () => Promise.resolve({ items: [], nextCursor: null }),
    });

    renderPage(client);

    await waitFor(() => expect(screen.getByText('No announcements yet.')).toBeInTheDocument());
  });

  it('"Load more" appends the next page without duplicating items, and disappears at the end', async () => {
    const first = announcement({ id: 'a1', body: 'First' });
    const second = announcement({ id: 'a2', body: 'Second' });
    const listAnnouncements = vi
      .fn()
      .mockResolvedValueOnce({ items: [first], nextCursor: 'cursor-1' })
      .mockResolvedValueOnce({ items: [second], nextCursor: null });
    const client = createFakeApiClient({ listAnnouncements });
    const user = userEvent.setup();

    renderPage(client);

    await waitFor(() => expect(screen.getByText('First')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Load more' }));

    await waitFor(() => expect(screen.getByText('Second')).toBeInTheDocument());
    expect(screen.getAllByText('First')).toHaveLength(1);
    expect(listAnnouncements).toHaveBeenNthCalledWith(2, { cursor: 'cursor-1' });
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('creates an announcement with exactly { body } and reloads the first page', async () => {
    const listAnnouncements = vi
      .fn()
      .mockResolvedValueOnce({ items: [], nextCursor: null })
      .mockResolvedValueOnce({ items: [announcement({ body: 'New one' })], nextCursor: null });
    const createAnnouncement = vi.fn().mockResolvedValue(announcement({ body: 'New one' }));
    const client = createFakeApiClient({ listAnnouncements, createAnnouncement });
    const user = userEvent.setup();

    renderPage(client);

    await waitFor(() => expect(screen.getByText('No announcements yet.')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'New announcement' }));
    await user.type(screen.getByLabelText('Body'), 'New one');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(createAnnouncement).toHaveBeenCalledExactlyOnceWith({ body: 'New one' }));
    await waitFor(() => expect(screen.getByText('New one')).toBeInTheDocument());
  });

  it('edits an announcement with exactly { body }, not postedAt', async () => {
    const existing = announcement();
    const listAnnouncements = vi.fn().mockResolvedValue({ items: [existing], nextCursor: null });
    const updateAnnouncement = vi.fn().mockResolvedValue({ ...existing, body: 'Updated body' });
    const client = createFakeApiClient({ listAnnouncements, updateAnnouncement });
    const user = userEvent.setup();

    renderPage(client);

    await waitFor(() => expect(screen.getByText(existing.body)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const textarea = screen.getByLabelText('Body');
    await user.clear(textarea);
    await user.type(textarea, 'Updated body');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(updateAnnouncement).toHaveBeenCalledExactlyOnceWith(existing.id, { body: 'Updated body' }),
    );
  });

  it('blocks an over-length body client-side without calling the API', async () => {
    const client = createFakeApiClient({
      listAnnouncements: () => Promise.resolve({ items: [], nextCursor: null }),
    });
    const user = userEvent.setup();

    renderPage(client);

    await waitFor(() => expect(screen.getByText('No announcements yet.')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'New announcement' }));
    const textarea = screen.getByLabelText('Body');
    // Paste rather than type — much faster than key-by-key for a string this
    // long, and this test only cares about the submitted length, not entry.
    await user.click(textarea);
    await user.paste('x'.repeat(ANNOUNCEMENT_BODY_MAX + 1));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText(/Body must be between 1 and 5000 characters\./),
    ).toBeInTheDocument();
    expect(client.createAnnouncement).not.toHaveBeenCalled();
  });

  it('does not delete until the confirmation dialog is confirmed', async () => {
    const existing = announcement();
    const listAnnouncements = vi.fn().mockResolvedValue({ items: [existing], nextCursor: null });
    const deleteAnnouncement = vi.fn().mockResolvedValue(undefined);
    const client = createFakeApiClient({ listAnnouncements, deleteAnnouncement });
    const user = userEvent.setup();

    renderPage(client);

    await waitFor(() => expect(screen.getByText(existing.body)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(deleteAnnouncement).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(deleteAnnouncement).toHaveBeenCalledExactlyOnceWith(existing.id));
  });

  it('surfaces a FORBIDDEN list error instead of crashing', async () => {
    const client = createFakeApiClient({
      listAnnouncements: () => Promise.reject(new ApiError(403, 'FORBIDDEN', 'Admins only.')),
    });

    renderPage(client);

    await waitFor(() => expect(screen.getByText('Admins only.')).toBeInTheDocument());
  });
});
