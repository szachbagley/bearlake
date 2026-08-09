import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ApiClientProvider, type ApiClient } from '../../../src/api/context.tsx';
import { ApiError } from '../../../src/api/client.ts';
import { CategoriesPage } from '../../../src/features/articles/CategoriesPage.tsx';
import type { ArticleSummary, InfoCategory } from '../../../src/types/api.ts';
import { createFakeApiClient } from '../../auth/testUtils.tsx';

function category(overrides: Partial<InfoCategory> = {}): InfoCategory {
  return {
    id: 'c1',
    title: 'Getting there',
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function article(overrides: Partial<ArticleSummary> = {}): ArticleSummary {
  return {
    id: 'a1',
    categoryId: 'c1',
    title: 'Article',
    status: 'draft',
    sortOrder: 0,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderPage(client: ApiClient) {
  return render(
    <MemoryRouter>
      <ApiClientProvider client={client}>
        <CategoriesPage />
      </ApiClientProvider>
    </MemoryRouter>,
  );
}

function row(title: string): HTMLElement {
  const link = screen.getByText(title, { exact: false });
  const li = link.closest('li');
  if (li === null) throw new Error(`no <li> ancestor for "${title}"`);
  return li;
}

describe('CategoriesPage', () => {
  it('renders categories with their article counts', async () => {
    const client = createFakeApiClient({
      listCategories: () => Promise.resolve({ categories: [category()] }),
      listArticlesByCategory: () =>
        Promise.resolve({ articles: [article({ id: 'a1' }), article({ id: 'a2' })] }),
    });

    renderPage(client);

    await waitFor(() => expect(screen.getByText(/Getting there/)).toBeInTheDocument());
    expect(screen.getByText('(2 articles)')).toBeInTheDocument();
  });

  it('shows an empty state when there are no categories', async () => {
    const client = createFakeApiClient({
      listCategories: () => Promise.resolve({ categories: [] }),
    });

    renderPage(client);

    await waitFor(() => expect(screen.getByText('No categories yet.')).toBeInTheDocument());
  });

  it('creates a category with exactly { title }', async () => {
    const listCategories = vi
      .fn()
      .mockResolvedValueOnce({ categories: [] })
      .mockResolvedValueOnce({ categories: [category({ title: 'New category' })] });
    const createCategory = vi.fn().mockResolvedValue(category({ title: 'New category' }));
    const client = createFakeApiClient({
      listCategories,
      createCategory,
      listArticlesByCategory: () => Promise.resolve({ articles: [] }),
    });
    const user = userEvent.setup();

    renderPage(client);

    await waitFor(() => expect(screen.getByText('No categories yet.')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'New category' }));
    await user.type(screen.getByLabelText('Title'), 'New category');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(createCategory).toHaveBeenCalledExactlyOnceWith({ title: 'New category' }));
  });

  it('renames a category with exactly { title }', async () => {
    const existing = category();
    const listCategories = vi.fn().mockResolvedValue({ categories: [existing] });
    const updateCategory = vi.fn().mockResolvedValue({ ...existing, title: 'Renamed' });
    const client = createFakeApiClient({
      listCategories,
      updateCategory,
      listArticlesByCategory: () => Promise.resolve({ articles: [] }),
    });
    const user = userEvent.setup();

    renderPage(client);

    await waitFor(() => expect(screen.getByText(/Getting there/)).toBeInTheDocument());
    await user.click(within(row('Getting there')).getByRole('button', { name: 'Rename' }));
    const titleInput = screen.getByLabelText('Title');
    await user.clear(titleInput);
    await user.type(titleInput, 'Renamed');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(updateCategory).toHaveBeenCalledExactlyOnceWith(existing.id, { title: 'Renamed' }),
    );
  });

  it('moving a category up swaps sortOrder with its neighbor via two PATCH calls', async () => {
    const first = category({ id: 'c1', title: 'First', sortOrder: 0 });
    const second = category({ id: 'c2', title: 'Second', sortOrder: 1 });
    const listCategories = vi.fn().mockResolvedValue({ categories: [first, second] });
    const updateCategory = vi.fn().mockResolvedValue(first);
    const client = createFakeApiClient({
      listCategories,
      updateCategory,
      listArticlesByCategory: () => Promise.resolve({ articles: [] }),
    });
    const user = userEvent.setup();

    renderPage(client);

    await waitFor(() => expect(screen.getByText(/Second/)).toBeInTheDocument());
    await user.click(within(row('Second')).getByRole('button', { name: 'Move up' }));

    await waitFor(() => expect(updateCategory).toHaveBeenCalledTimes(2));
    expect(updateCategory).toHaveBeenCalledWith('c2', { sortOrder: 0 });
    expect(updateCategory).toHaveBeenCalledWith('c1', { sortOrder: 1 });
  });

  it('does not delete until the confirmation dialog is confirmed', async () => {
    const existing = category();
    const listCategories = vi.fn().mockResolvedValue({ categories: [existing] });
    const deleteCategory = vi.fn().mockResolvedValue(undefined);
    const client = createFakeApiClient({
      listCategories,
      deleteCategory,
      listArticlesByCategory: () => Promise.resolve({ articles: [] }),
    });
    const user = userEvent.setup();

    renderPage(client);

    await waitFor(() => expect(screen.getByText(/Getting there/)).toBeInTheDocument());
    await user.click(within(row('Getting there')).getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(deleteCategory).not.toHaveBeenCalled();

    await user.click(within(row('Getting there')).getByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(deleteCategory).toHaveBeenCalledExactlyOnceWith(existing.id));
  });

  it('renders the CATEGORY_NOT_EMPTY message when delete is refused', async () => {
    const existing = category();
    const listCategories = vi.fn().mockResolvedValue({ categories: [existing] });
    const deleteCategory = vi
      .fn()
      .mockRejectedValue(
        new ApiError(409, 'CATEGORY_NOT_EMPTY', "Move or delete this category's articles first."),
      );
    const client = createFakeApiClient({
      listCategories,
      deleteCategory,
      listArticlesByCategory: () => Promise.resolve({ articles: [] }),
    });
    const user = userEvent.setup();

    renderPage(client);

    await waitFor(() => expect(screen.getByText(/Getting there/)).toBeInTheDocument());
    await user.click(within(row('Getting there')).getByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(
      await screen.findByText("Move or delete this category's articles first."),
    ).toBeInTheDocument();
  });
});
