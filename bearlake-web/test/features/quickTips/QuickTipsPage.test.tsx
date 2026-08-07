import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiClientProvider, type ApiClient } from '../../../src/api/context.tsx';
import { ApiError } from '../../../src/api/client.ts';
import { QuickTipsPage } from '../../../src/features/quickTips/QuickTipsPage.tsx';
import type { QuickTip } from '../../../src/types/api.ts';
import { QUICK_TIP_BODY_MAX } from '../../../src/types/limits.ts';
import { createFakeApiClient } from '../../auth/testUtils.tsx';

function quickTip(overrides: Partial<QuickTip> = {}): QuickTip {
  return {
    id: 't1',
    body: 'Gate code is 4471.',
    sortOrder: 0,
    createdBy: 'u1',
    createdAt: '2026-07-01T12:00:00.000Z',
    updatedAt: '2026-07-01T12:00:00.000Z',
    ...overrides,
  };
}

function renderPage(client: ApiClient) {
  return render(
    <ApiClientProvider client={client}>
      <QuickTipsPage />
    </ApiClientProvider>,
  );
}

function row(body: string): HTMLElement {
  const text = screen.getByText(body);
  const li = text.closest('li');
  if (li === null) throw new Error(`no <li> ancestor for "${body}"`);
  return li;
}

describe('QuickTipsPage', () => {
  it('renders tips in the order the server returns them', async () => {
    const client = createFakeApiClient({
      listQuickTips: () =>
        Promise.resolve({
          quickTips: [quickTip({ id: 't1', body: 'First', sortOrder: 0 }), quickTip({ id: 't2', body: 'Second', sortOrder: 1 })],
        }),
    });

    renderPage(client);

    await waitFor(() => expect(screen.getByText('First')).toBeInTheDocument());
    expect(screen.getByText('Second')).toBeInTheDocument();
  });

  it('shows an empty state when there are no quick tips', async () => {
    const client = createFakeApiClient({ listQuickTips: () => Promise.resolve({ quickTips: [] }) });

    renderPage(client);

    await waitFor(() => expect(screen.getByText('No quick tips yet.')).toBeInTheDocument());
  });

  it('creates a quick tip with exactly { body }, no sortOrder', async () => {
    const listQuickTips = vi
      .fn()
      .mockResolvedValueOnce({ quickTips: [] })
      .mockResolvedValueOnce({ quickTips: [quickTip({ body: 'New tip' })] });
    const createQuickTip = vi.fn().mockResolvedValue(quickTip({ body: 'New tip' }));
    const client = createFakeApiClient({ listQuickTips, createQuickTip });
    const user = userEvent.setup();

    renderPage(client);

    await waitFor(() => expect(screen.getByText('No quick tips yet.')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'New quick tip' }));
    await user.type(screen.getByLabelText('Body'), 'New tip');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(createQuickTip).toHaveBeenCalledExactlyOnceWith({ body: 'New tip' }));
  });

  it('edits a quick tip with exactly { body }', async () => {
    const existing = quickTip();
    const listQuickTips = vi.fn().mockResolvedValue({ quickTips: [existing] });
    const updateQuickTip = vi.fn().mockResolvedValue({ ...existing, body: 'Updated' });
    const client = createFakeApiClient({ listQuickTips, updateQuickTip });
    const user = userEvent.setup();

    renderPage(client);

    await waitFor(() => expect(screen.getByText(existing.body)).toBeInTheDocument());
    await user.click(within(row(existing.body)).getByRole('button', { name: 'Edit' }));
    const textarea = screen.getByLabelText('Body');
    await user.clear(textarea);
    await user.type(textarea, 'Updated');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(updateQuickTip).toHaveBeenCalledExactlyOnceWith(existing.id, { body: 'Updated' }),
    );
  });

  it('blocks an over-length body client-side without calling the API', async () => {
    const client = createFakeApiClient({ listQuickTips: () => Promise.resolve({ quickTips: [] }) });
    const user = userEvent.setup();

    renderPage(client);

    await waitFor(() => expect(screen.getByText('No quick tips yet.')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'New quick tip' }));
    const textarea = screen.getByLabelText('Body');
    await user.click(textarea);
    await user.paste('x'.repeat(QUICK_TIP_BODY_MAX + 1));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(/Body must be between 1 and 1000 characters\./)).toBeInTheDocument();
    expect(client.createQuickTip).not.toHaveBeenCalled();
  });

  it('does not delete until the confirmation dialog is confirmed', async () => {
    const existing = quickTip();
    const listQuickTips = vi.fn().mockResolvedValue({ quickTips: [existing] });
    const deleteQuickTip = vi.fn().mockResolvedValue(undefined);
    const client = createFakeApiClient({ listQuickTips, deleteQuickTip });
    const user = userEvent.setup();

    renderPage(client);

    await waitFor(() => expect(screen.getByText(existing.body)).toBeInTheDocument());
    await user.click(within(row(existing.body)).getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(deleteQuickTip).not.toHaveBeenCalled();

    await user.click(within(row(existing.body)).getByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(deleteQuickTip).toHaveBeenCalledExactlyOnceWith(existing.id));
  });

  it('moving a tip up swaps sortOrder with its neighbor via two PATCH calls', async () => {
    const first = quickTip({ id: 't1', body: 'First', sortOrder: 0 });
    const second = quickTip({ id: 't2', body: 'Second', sortOrder: 1 });
    const listQuickTips = vi.fn().mockResolvedValue({ quickTips: [first, second] });
    const updateQuickTip = vi.fn().mockResolvedValue(first);
    const client = createFakeApiClient({ listQuickTips, updateQuickTip });
    const user = userEvent.setup();

    renderPage(client);

    await waitFor(() => expect(screen.getByText('Second')).toBeInTheDocument());
    await user.click(within(row('Second')).getByRole('button', { name: 'Move up' }));

    await waitFor(() => expect(updateQuickTip).toHaveBeenCalledTimes(2));
    expect(updateQuickTip).toHaveBeenCalledWith('t2', { sortOrder: 0 });
    expect(updateQuickTip).toHaveBeenCalledWith('t1', { sortOrder: 1 });
  });

  it('disables "Move up" on the first row and "Move down" on the last row', async () => {
    const first = quickTip({ id: 't1', body: 'First', sortOrder: 0 });
    const second = quickTip({ id: 't2', body: 'Second', sortOrder: 1 });
    const client = createFakeApiClient({
      listQuickTips: () => Promise.resolve({ quickTips: [first, second] }),
    });

    renderPage(client);

    await waitFor(() => expect(screen.getByText('Second')).toBeInTheDocument());
    expect(within(row('First')).getByRole('button', { name: 'Move up' })).toBeDisabled();
    expect(within(row('Second')).getByRole('button', { name: 'Move down' })).toBeDisabled();
    expect(within(row('First')).getByRole('button', { name: 'Move down' })).toBeEnabled();
    expect(within(row('Second')).getByRole('button', { name: 'Move up' })).toBeEnabled();
  });

  it('surfaces a FORBIDDEN list error instead of crashing', async () => {
    const client = createFakeApiClient({
      listQuickTips: () => Promise.reject(new ApiError(403, 'FORBIDDEN', 'Admins only.')),
    });

    renderPage(client);

    await waitFor(() => expect(screen.getByText('Admins only.')).toBeInTheDocument());
  });
});
