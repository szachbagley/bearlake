import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ApiClientProvider, type ApiClient } from '../../../src/api/context.tsx';
import { CategoryPage } from '../../../src/features/articles/CategoryPage.tsx';
import type { ArticleSummary, InfoArticle, InfoCategory } from '../../../src/types/api.ts';
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
    title: 'Driving directions',
    status: 'draft',
    sortOrder: 0,
    updatedAt: '2026-02-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderPage(client: ApiClient, initialPath = '/knowledge/categories/c1') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <ApiClientProvider client={client}>
        <Routes>
          <Route path="/knowledge/categories/:id" element={<CategoryPage />} />
          <Route path="/knowledge/articles/:id" element={<div>article editor placeholder</div>} />
        </Routes>
      </ApiClientProvider>
    </MemoryRouter>,
  );
}

function row(title: string): HTMLElement {
  const link = screen.getByText(title);
  const li = link.closest('li');
  if (li === null) throw new Error(`no <li> ancestor for "${title}"`);
  return li;
}

describe('CategoryPage', () => {
  it("renders the category's title and its articles with status badges", async () => {
    const client = createFakeApiClient({
      listCategories: () => Promise.resolve({ categories: [category()] }),
      listArticlesByCategory: () =>
        Promise.resolve({
          articles: [
            article({ id: 'a1', title: 'Draft one', status: 'draft' }),
            article({ id: 'a2', title: 'Published one', status: 'published' }),
          ],
        }),
    });

    renderPage(client);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Getting there' })).toBeInTheDocument());
    expect(within(row('Draft one')).getByText('Draft')).toBeInTheDocument();
    expect(within(row('Published one')).getByText('Published')).toBeInTheDocument();
  });

  it('shows an empty state when the category has no articles', async () => {
    const client = createFakeApiClient({
      listCategories: () => Promise.resolve({ categories: [category()] }),
      listArticlesByCategory: () => Promise.resolve({ articles: [] }),
    });

    renderPage(client);

    await waitFor(() => expect(screen.getByText('No articles yet.')).toBeInTheDocument());
  });

  it("creates a new article with status: 'draft' and navigates to the returned id", async () => {
    const created: InfoArticle = {
      id: 'new-article-id',
      categoryId: 'c1',
      title: 'New guide',
      blocks: [],
      schemaVersion: 1,
      status: 'draft',
      sortOrder: 0,
      createdBy: 'u1',
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-01T00:00:00.000Z',
    };
    const createArticle = vi.fn().mockResolvedValue(created);
    const client = createFakeApiClient({
      listCategories: () => Promise.resolve({ categories: [category()] }),
      listArticlesByCategory: () => Promise.resolve({ articles: [] }),
      createArticle,
    });
    const user = userEvent.setup();

    renderPage(client);

    await waitFor(() => expect(screen.getByText('No articles yet.')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'New article' }));
    await user.type(screen.getByLabelText('Title'), 'New guide');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(createArticle).toHaveBeenCalledExactlyOnceWith({
        categoryId: 'c1',
        title: 'New guide',
        blocks: [],
        status: 'draft',
      }),
    );
    expect(await screen.findByText('article editor placeholder')).toBeInTheDocument();
  });

  it('does not delete until the confirmation dialog is confirmed', async () => {
    const existing = article();
    const deleteArticle = vi.fn().mockResolvedValue(undefined);
    const client = createFakeApiClient({
      listCategories: () => Promise.resolve({ categories: [category()] }),
      listArticlesByCategory: () => Promise.resolve({ articles: [existing] }),
      deleteArticle,
    });
    const user = userEvent.setup();

    renderPage(client);

    await waitFor(() => expect(screen.getByText(existing.title)).toBeInTheDocument());
    await user.click(within(row(existing.title)).getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(deleteArticle).not.toHaveBeenCalled();

    await user.click(within(row(existing.title)).getByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(deleteArticle).toHaveBeenCalledExactlyOnceWith(existing.id));
  });

  it('moving an article swaps sortOrder via two PATCH calls, each carrying its own updatedAt', async () => {
    const first = article({ id: 'a1', title: 'First', sortOrder: 0, updatedAt: '2026-01-01T00:00:00.000Z' });
    const second = article({ id: 'a2', title: 'Second', sortOrder: 1, updatedAt: '2026-02-01T00:00:00.000Z' });
    const updateArticle = vi.fn().mockResolvedValue(first);
    const client = createFakeApiClient({
      listCategories: () => Promise.resolve({ categories: [category()] }),
      listArticlesByCategory: () => Promise.resolve({ articles: [first, second] }),
      updateArticle,
    });
    const user = userEvent.setup();

    renderPage(client);

    await waitFor(() => expect(screen.getByText('Second')).toBeInTheDocument());
    await user.click(within(row('Second')).getByRole('button', { name: 'Move up' }));

    await waitFor(() => expect(updateArticle).toHaveBeenCalledTimes(2));
    expect(updateArticle).toHaveBeenCalledWith('a2', {
      sortOrder: 0,
      updatedAt: '2026-02-01T00:00:00.000Z',
    });
    expect(updateArticle).toHaveBeenCalledWith('a1', {
      sortOrder: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
  });
});
