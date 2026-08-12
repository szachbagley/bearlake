import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClientProvider, type ApiClient } from '../../../src/api/context.tsx';
import { ApiError } from '../../../src/api/client.ts';
import { ArticleEditorPage } from '../../../src/features/articles/ArticleEditorPage.tsx';
import * as uploadModule from '../../../src/features/articles/upload.ts';
import type { InfoArticle, InfoCategory } from '../../../src/types/api.ts';
import type { ApiBlock } from '../../../src/types/blocks.ts';
import { createFakeApiClient } from '../../auth/testUtils.tsx';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

function article(overrides: Partial<InfoArticle> = {}): InfoArticle {
  return {
    id: 'a1',
    categoryId: 'c1',
    title: 'Driving directions',
    blocks: [],
    schemaVersion: 1,
    status: 'draft',
    sortOrder: 0,
    createdBy: 'u1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderEditor(client: ApiClient, articleId = 'a1') {
  const router = createMemoryRouter(
    [
      { path: '/knowledge/articles/:id', element: <ArticleEditorPage /> },
      { path: '/knowledge', element: <div>knowledge base placeholder</div> },
    ],
    { initialEntries: [`/knowledge/articles/${articleId}`] },
  );
  return {
    ...render(
      <ApiClientProvider client={client}>
        <RouterProvider router={router} />
      </ApiClientProvider>,
    ),
    router,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ArticleEditorPage — loading', () => {
  it('loads the article and category list, and shows the title', async () => {
    const client = createFakeApiClient({
      getArticle: () => Promise.resolve(article()),
      listCategories: () => Promise.resolve({ categories: [category()] }),
    });

    renderEditor(client);

    await waitFor(() => expect(screen.getByLabelText('Title')).toHaveValue('Driving directions'));
    expect(screen.getByRole('option', { name: 'Getting there' })).toBeInTheDocument();
  });
});

describe('ArticleEditorPage — adding blocks', () => {
  function baseClient() {
    return createFakeApiClient({
      getArticle: () => Promise.resolve(article()),
      listCategories: () => Promise.resolve({ categories: [category()] }),
    });
  }

  it('adding one of each block type produces blocks the mirrored schema accepts, with unique UUID ids', async () => {
    const updateArticle = vi.fn().mockResolvedValue(article());
    const client = createFakeApiClient({
      getArticle: () => Promise.resolve(article()),
      listCategories: () => Promise.resolve({ categories: [category()] }),
      updateArticle,
    });
    const user = userEvent.setup();

    renderEditor(client);
    await waitFor(() => expect(screen.getByLabelText('Title')).toHaveValue('Driving directions'));

    await user.click(screen.getByRole('button', { name: '+ Heading' }));
    await user.click(screen.getByRole('button', { name: '+ Paragraph' }));
    await user.click(screen.getByRole('button', { name: '+ Bullet list' }));
    await user.click(screen.getByRole('button', { name: '+ Video' }));

    // fireEvent.change, not user.type: this test asserts the *payload shape*
    // produced by adding one of each block, not keystroke handling. Typing
    // these four strings character-by-character is ~80 controlled-input
    // re-renders, which pushed the test past the default timeout whenever the
    // full suite ran under load — flaky for no added coverage.
    fireEvent.change(screen.getByLabelText('Heading'), { target: { value: 'Section one' } });
    fireEvent.change(screen.getByLabelText('Paragraph'), {
      target: { value: 'Take the second exit.' },
    });
    fireEvent.change(screen.getByLabelText('Bullet 1'), { target: { value: 'Pack sunscreen' } });
    fireEvent.change(screen.getByLabelText('YouTube URL or video id'), {
      target: { value: 'dQw4w9WgXcQ' },
    });

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(updateArticle).toHaveBeenCalledOnce());
    const patch = updateArticle.mock.calls[0]?.[1] as { blocks: ApiBlock[] };
    expect(patch.blocks).toHaveLength(4);

    const ids = patch.blocks.map((b) => b.id);
    expect(new Set(ids).size).toBe(4);
    for (const id of ids) expect(id).toMatch(UUID_RE);

    expect(patch.blocks[0]).toEqual({ id: ids[0], type: 'heading', text: 'Section one' });
    expect(patch.blocks[1]).toEqual({ id: ids[1], type: 'paragraph', text: 'Take the second exit.' });
    expect(patch.blocks[2]).toEqual({ id: ids[2], type: 'bullets', items: ['Pack sunscreen'] });
    expect(patch.blocks[3]).toEqual({
      id: ids[3],
      type: 'video',
      provider: 'youtube',
      videoId: 'dQw4w9WgXcQ',
    });
  });

  it('the Save button is disabled until something is dirty', async () => {
    const client = baseClient();
    renderEditor(client);
    await waitFor(() => expect(screen.getByLabelText('Title')).toHaveValue('Driving directions'));

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});

describe('ArticleEditorPage — reordering and deleting blocks', () => {
  it('move up/down reorders blocks and preserves their ids', async () => {
    const existing = article({
      blocks: [
        { id: 'a136d52f-0527-446a-9aa8-b9bcf129fddc', type: 'heading', text: 'First' },
        { id: '3ecce68b-0178-452c-a1b3-78cf25d2d835', type: 'heading', text: 'Second' },
      ],
    });
    const client = createFakeApiClient({
      getArticle: () => Promise.resolve(existing),
      listCategories: () => Promise.resolve({ categories: [category()] }),
    });
    const user = userEvent.setup();

    renderEditor(client);
    await waitFor(() => expect(screen.getAllByLabelText('Heading')).toHaveLength(2));

    const moveUpButtons = screen.getAllByRole('button', { name: 'Move block up' });
    const second = moveUpButtons[1];
    if (second === undefined) throw new Error('expected a second "Move block up" button');
    await user.click(second);

    const headings = screen.getAllByLabelText('Heading');
    expect(headings[0]).toHaveValue('Second');
    expect(headings[1]).toHaveValue('First');
  });

  it('delete removes only the target block, behind confirmation', async () => {
    const existing = article({
      blocks: [
        { id: 'a136d52f-0527-446a-9aa8-b9bcf129fddc', type: 'heading', text: 'Keep me' },
        { id: '3ecce68b-0178-452c-a1b3-78cf25d2d835', type: 'heading', text: 'Delete me' },
        { id: '11cacd2c-a454-4899-aabe-06d044652788', type: 'heading', text: 'Keep me too' },
      ],
    });
    const client = createFakeApiClient({
      getArticle: () => Promise.resolve(existing),
      listCategories: () => Promise.resolve({ categories: [category()] }),
    });
    const user = userEvent.setup();

    renderEditor(client);
    await waitFor(() => expect(screen.getAllByLabelText('Heading')).toHaveLength(3));

    const deleteButtons = screen.getAllByRole('button', { name: 'Delete block' });
    const target = deleteButtons[1];
    if (target === undefined) throw new Error('expected a second "Delete block" button');
    await user.click(target);

    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    const remaining = screen.getAllByLabelText('Heading');
    expect(remaining).toHaveLength(2);
    expect(remaining.map((el) => (el as HTMLInputElement).value)).toEqual(['Keep me', 'Keep me too']);
  });
});

describe('ArticleEditorPage — unknown block preservation', () => {
  it('round-trips an unknown block byte-identical through an unrelated edit and save', async () => {
    const unknownBlock = { id: 'fd10d08d-8e32-41db-8272-8449a8922595', type: 'callout', style: 'warning', text: 'Careful here.' };
    const existing = article({ blocks: [unknownBlock] as unknown as ApiBlock[] });
    const updateArticle = vi.fn().mockResolvedValue(existing);
    const client = createFakeApiClient({
      getArticle: () => Promise.resolve(existing),
      listCategories: () => Promise.resolve({ categories: [category()] }),
      updateArticle,
    });
    const user = userEvent.setup();

    renderEditor(client);
    await waitFor(() =>
      expect(screen.getByText('Unsupported block — preserved on save.')).toBeInTheDocument(),
    );

    // An unrelated edit — the title, not the unknown block.
    const title = screen.getByLabelText('Title');
    await user.type(title, '!');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(updateArticle).toHaveBeenCalledOnce());
    const patch = updateArticle.mock.calls[0]?.[1] as { blocks: unknown[] };
    expect(patch.blocks).toEqual([unknownBlock]);
  });
});

describe('ArticleEditorPage — image blocks never write url', () => {
  it('strips the transient url from every image block in the save payload', async () => {
    const existing = article({
      blocks: [
        { id: 'fa22f44a-e35d-4b4d-83c0-2246e44d7096', type: 'image', key: 'articles/a1136d52-0527-446a-9aa8-b9bcf129fddc/fa22f44a-e35d-4b4d-83c0-2246e44d7096', url: 'https://s3.example/signed' },
      ],
    });
    const updateArticle = vi.fn().mockResolvedValue(existing);
    const client = createFakeApiClient({
      getArticle: () => Promise.resolve(existing),
      listCategories: () => Promise.resolve({ categories: [category()] }),
      updateArticle,
    });
    const user = userEvent.setup();

    renderEditor(client);
    await waitFor(() => expect(screen.getByLabelText('Title')).toHaveValue('Driving directions'));

    const title = screen.getByLabelText('Title');
    await user.type(title, '!');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(updateArticle).toHaveBeenCalledOnce());
    const patch = updateArticle.mock.calls[0]?.[1] as { blocks: unknown[] };
    expect(JSON.stringify(patch.blocks)).not.toContain('url');
    expect(patch.blocks).toEqual([{ id: 'fa22f44a-e35d-4b4d-83c0-2246e44d7096', type: 'image', key: 'articles/a1136d52-0527-446a-9aa8-b9bcf129fddc/fa22f44a-e35d-4b4d-83c0-2246e44d7096' }]);
  });

  it('strips url from a freshly uploaded image before the first save', async () => {
    vi.spyOn(uploadModule, 'uploadImage').mockResolvedValue('articles/a1136d52-0527-446a-9aa8-b9bcf129fddc/aaaaaaaa-e35d-4b4d-83c0-2246e44d7096');
    const existing = article();
    const updateArticle = vi.fn().mockResolvedValue(existing);
    const client = createFakeApiClient({
      getArticle: () => Promise.resolve(existing),
      listCategories: () => Promise.resolve({ categories: [category()] }),
      updateArticle,
    });
    const user = userEvent.setup();

    renderEditor(client);
    await waitFor(() => expect(screen.getByLabelText('Title')).toHaveValue('Driving directions'));

    const file = new File([new Uint8Array([1, 2, 3])], 'dock.jpg', { type: 'image/jpeg' });
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
    if (fileInput === null) throw new Error('file input not found');
    await user.upload(fileInput, file);

    await waitFor(() => expect(screen.getByRole('img')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(updateArticle).toHaveBeenCalledOnce());
    const patch = updateArticle.mock.calls[0]?.[1] as { blocks: unknown[] };
    expect(JSON.stringify(patch.blocks)).not.toContain('url');
    expect(patch.blocks).toEqual([{ id: expect.stringMatching(UUID_RE), type: 'image', key: 'articles/a1136d52-0527-446a-9aa8-b9bcf129fddc/aaaaaaaa-e35d-4b4d-83c0-2246e44d7096' }]);
  });
});

describe('ArticleEditorPage — stale article conflict (409)', () => {
  it('shows the reload/copy prompt and never silently overwrites', async () => {
    const existing = article({ title: 'Original title' });
    const updateArticle = vi
      .fn()
      .mockRejectedValue(new ApiError(409, 'STALE_ARTICLE', 'This article was changed elsewhere.'));
    const client = createFakeApiClient({
      getArticle: () => Promise.resolve(existing),
      listCategories: () => Promise.resolve({ categories: [category()] }),
      updateArticle,
    });
    const user = userEvent.setup();

    renderEditor(client);
    await waitFor(() => expect(screen.getByLabelText('Title')).toHaveValue('Original title'));

    const title = screen.getByLabelText('Title');
    await user.type(title, ' (edited)');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('This article changed elsewhere')).toBeInTheDocument();
    // Never silently overwritten: the local (unsaved) edit is still shown,
    // not reverted or replaced by anything from the failed response.
    expect(screen.getByLabelText('Title')).toHaveValue('Original title (edited)');
  });

  it('Reload discards local edits and refetches the article', async () => {
    const original = article({ title: 'Original title' });
    const refreshed = article({ title: 'Someone else changed this', updatedAt: '2026-02-01T00:00:00.000Z' });
    const getArticle = vi.fn().mockResolvedValueOnce(original).mockResolvedValueOnce(refreshed);
    const updateArticle = vi
      .fn()
      .mockRejectedValue(new ApiError(409, 'STALE_ARTICLE', 'This article was changed elsewhere.'));
    const client = createFakeApiClient({
      getArticle,
      listCategories: () => Promise.resolve({ categories: [category()] }),
      updateArticle,
    });
    const user = userEvent.setup();

    renderEditor(client);
    await waitFor(() => expect(screen.getByLabelText('Title')).toHaveValue('Original title'));
    const title = screen.getByLabelText('Title');
    await user.type(title, ' (edited)');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('This article changed elsewhere');

    await user.click(screen.getByRole('button', { name: 'Reload' }));

    await waitFor(() => expect(screen.getByLabelText('Title')).toHaveValue('Someone else changed this'));
  });

  it('Copy my changes copies the local blocks JSON to the clipboard, then reloads', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    // user-event's own setup() installs a clipboard mock of its own — it
    // must run first, or vi.stubGlobal's replacement gets clobbered by it
    // (see Phase 5's UsersPage tests for the same finding).
    const user = userEvent.setup();
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });

    const original = article({
      title: 'Original title',
      blocks: [{ id: 'a136d52f-0527-446a-9aa8-b9bcf129fddc', type: 'heading', text: 'Kept' }],
    });
    const refreshed = article({ title: 'Someone else changed this' });
    const getArticle = vi.fn().mockResolvedValueOnce(original).mockResolvedValueOnce(refreshed);
    const updateArticle = vi
      .fn()
      .mockRejectedValue(new ApiError(409, 'STALE_ARTICLE', 'This article was changed elsewhere.'));
    const client = createFakeApiClient({
      getArticle,
      listCategories: () => Promise.resolve({ categories: [category()] }),
      updateArticle,
    });

    renderEditor(client);
    await waitFor(() => expect(screen.getByLabelText('Title')).toHaveValue('Original title'));
    const title = screen.getByLabelText('Title');
    await user.type(title, '!');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('This article changed elsewhere');

    await user.click(screen.getByRole('button', { name: 'Copy my changes' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    const copiedJson = writeText.mock.calls[0]?.[0] as string;
    expect(JSON.parse(copiedJson)).toEqual([
      { id: 'a136d52f-0527-446a-9aa8-b9bcf129fddc', type: 'heading', text: 'Kept' },
    ]);
    await waitFor(() => expect(screen.getByLabelText('Title')).toHaveValue('Someone else changed this'));

    vi.unstubAllGlobals();
  });
});

describe('ArticleEditorPage — accessibility', () => {
  it('announces a successful save in a polite live region', async () => {
    const updateArticle = vi.fn().mockResolvedValue(article({ title: 'Renamed' }));
    const client = createFakeApiClient({
      getArticle: () => Promise.resolve(article()),
      listCategories: () => Promise.resolve({ categories: [category()] }),
      updateArticle,
    });
    const user = userEvent.setup();

    renderEditor(client);
    await waitFor(() => expect(screen.getByLabelText('Title')).toHaveValue('Driving directions'));

    // The only visible success cue is the "Unsaved changes" indicator
    // disappearing, which a screen reader user never perceives.
    await user.type(screen.getByLabelText('Title'), '!');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Article saved.')).toBeInTheDocument();
  });

  it('labels the hidden file input and keeps it out of the tab order', async () => {
    const client = createFakeApiClient({
      getArticle: () => Promise.resolve(article()),
      listCategories: () => Promise.resolve({ categories: [category()] }),
    });

    renderEditor(client);
    await waitFor(() => expect(screen.getByLabelText('Title')).toHaveValue('Driving directions'));

    const fileInput = screen.getByLabelText('Choose a photo to upload');
    expect(fileInput).toHaveAttribute('type', 'file');
    expect(fileInput).toHaveAttribute('tabindex', '-1');
  });
});

describe('ArticleEditorPage — dirty guard', () => {
  it('fires a confirmation on in-app navigation with unsaved changes', async () => {
    const client = createFakeApiClient({
      getArticle: () => Promise.resolve(article()),
      listCategories: () => Promise.resolve({ categories: [category()] }),
    });
    const user = userEvent.setup();

    renderEditor(client);
    await waitFor(() => expect(screen.getByLabelText('Title')).toHaveValue('Driving directions'));

    await user.type(screen.getByLabelText('Title'), '!');
    await user.click(screen.getByRole('link', { name: '← Knowledge base' }));

    expect(await screen.findByText('Discard unsaved changes?')).toBeInTheDocument();
    expect(screen.queryByText('knowledge base placeholder')).not.toBeInTheDocument();
  });

  it('does not block navigation when there are no unsaved changes', async () => {
    const client = createFakeApiClient({
      getArticle: () => Promise.resolve(article()),
      listCategories: () => Promise.resolve({ categories: [category()] }),
    });
    const user = userEvent.setup();

    renderEditor(client);
    await waitFor(() => expect(screen.getByLabelText('Title')).toHaveValue('Driving directions'));

    await user.click(screen.getByRole('link', { name: '← Knowledge base' }));

    expect(await screen.findByText('knowledge base placeholder')).toBeInTheDocument();
  });
});
