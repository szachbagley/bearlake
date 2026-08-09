import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useBlocker, useParams } from 'react-router-dom';
import { ApiError } from '../../api/client.ts';
import { useApiClient } from '../../api/context.tsx';
import { ConfirmDialog } from '../../components/ConfirmDialog.tsx';
import { ErrorBanner } from '../../components/ErrorBanner.tsx';
import { Spinner } from '../../components/Spinner.tsx';
import type { ArticleStatus, InfoArticle, InfoCategory, UpdateArticleRequest } from '../../types/api.ts';
import { blocksSchema, stripImageUrls, type ApiBlock, type KnownBlockType } from '../../types/blocks.ts';
import { ARTICLE_TITLE_MAX, ARTICLE_TITLE_MIN } from '../../types/limits.ts';
import { AddBlockMenu } from './blocks/AddBlockMenu.tsx';
import { BlockList } from './blocks/BlockList.tsx';
import { StaleArticleDialog } from './StaleArticleDialog.tsx';
import { uploadImage } from './upload.ts';

function snapshotOf(title: string, categoryId: string, status: ArticleStatus, blocks: ApiBlock[]): string {
  return JSON.stringify({ title, categoryId, status, blocks });
}

function defaultBlockOf(type: Exclude<KnownBlockType, 'image'>): ApiBlock {
  const id = crypto.randomUUID();
  switch (type) {
    case 'heading':
      return { id, type: 'heading', text: '' };
    case 'paragraph':
      return { id, type: 'paragraph', text: '' };
    case 'bullets':
      return { id, type: 'bullets', items: [''] };
    case 'video':
      return { id, type: 'video', provider: 'youtube', videoId: '' };
  }
}

/**
 * The article block editor (plan Phase 8) — the centerpiece of the app.
 * Holds all editing state locally and saves only on an explicit action
 * (plan W22): the Save button, `Cmd/Ctrl+S`, never autosave. A dirty guard
 * blocks in-app navigation and tab close while there are unsaved changes.
 */
export function ArticleEditorPage() {
  const { id } = useParams<{ id: string }>();
  const api = useApiClient();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [categories, setCategories] = useState<InfoCategory[]>([]);

  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState<ArticleStatus>('draft');
  const [blocks, setBlocks] = useState<ApiBlock[]>([]);
  const [updatedAt, setUpdatedAt] = useState('');
  const [savedSnapshot, setSavedSnapshot] = useState('');

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [staleConflict, setStaleConflict] = useState(false);

  const [uploading, setUploading] = useState<{ fileName: string; progress: number } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  function applyArticle(article: InfoArticle): void {
    setTitle(article.title);
    setCategoryId(article.categoryId);
    setStatus(article.status);
    setBlocks(article.blocks);
    setUpdatedAt(article.updatedAt);
    setSavedSnapshot(snapshotOf(article.title, article.categoryId, article.status, article.blocks));
  }

  const loadArticle = useCallback(async () => {
    if (id === undefined) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [article, { categories: loadedCategories }] = await Promise.all([
        api.getArticle(id),
        api.listCategories(),
      ]);
      applyArticle(article);
      setCategories(loadedCategories);
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      setLoadError(err);
    } finally {
      setLoading(false);
    }
  }, [api, id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadArticle();
  }, [loadArticle]);

  const dirty = useMemo(
    () => snapshotOf(title, categoryId, status, blocks) !== savedSnapshot,
    [title, categoryId, status, blocks, savedSnapshot],
  );

  function handleBlockChange(index: number, next: ApiBlock): void {
    setBlocks((prev) => prev.map((b, i) => (i === index ? next : b)));
  }

  function handleBlockMove(index: number, direction: -1 | 1): void {
    setBlocks((prev) => {
      const target = index + direction;
      const a = prev[index];
      const b = prev[target];
      if (a === undefined || b === undefined) return prev;
      const next = [...prev];
      next[index] = b;
      next[target] = a;
      return next;
    });
  }

  function handleBlockDelete(index: number): void {
    setBlocks((prev) => prev.filter((_, i) => i !== index));
  }

  function handleAddBlock(type: Exclude<KnownBlockType, 'image'>): void {
    setBlocks((prev) => [...prev, defaultBlockOf(type)]);
  }

  async function handlePickPhoto(file: File): Promise<void> {
    if (id === undefined) return;
    setUploadError(null);
    setUploading({ fileName: file.name, progress: 0 });
    try {
      const key = await uploadImage(api, id, file, (percent) => {
        setUploading({ fileName: file.name, progress: percent });
      });
      setBlocks((prev) => [
        ...prev,
        { id: crypto.randomUUID(), type: 'image', key, url: URL.createObjectURL(file) },
      ]);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'The photo could not be uploaded.');
    } finally {
      setUploading(null);
    }
  }

  const handleSave = useCallback(async () => {
    if (id === undefined || !dirty) return;
    setValidationError(null);
    setSaveError(null);

    const trimmedTitle = title.trim();
    if (trimmedTitle.length < ARTICLE_TITLE_MIN || trimmedTitle.length > ARTICLE_TITLE_MAX) {
      setValidationError(
        `Title must be between ${String(ARTICLE_TITLE_MIN)} and ${String(ARTICLE_TITLE_MAX)} characters.`,
      );
      return;
    }

    const strippedBlocks = stripImageUrls(blocks);
    const parsed = blocksSchema.safeParse(strippedBlocks);
    if (!parsed.success) {
      setValidationError(parsed.error.issues[0]?.message ?? 'One of the blocks is invalid.');
      return;
    }

    setSaving(true);
    try {
      const patch: UpdateArticleRequest = {
        categoryId,
        title: trimmedTitle,
        blocks: parsed.data,
        status,
        updatedAt,
      };
      const result = await api.updateArticle(id, patch);
      applyArticle(result);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'STALE_ARTICLE') {
        setStaleConflict(true);
      } else {
        setSaveError(err);
      }
    } finally {
      setSaving(false);
    }
  }, [id, dirty, title, categoryId, status, blocks, updatedAt, api]);

  function handleStaleReload(): void {
    setStaleConflict(false);
    void loadArticle();
  }

  // Dirty guard (plan W22): tab close...
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent): void {
      if (!dirty) return;
      e.preventDefault();
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [dirty]);

  // ...and Cmd/Ctrl+S to save.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        void handleSave();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave]);

  // ...and in-app navigation.
  const blocker = useBlocker(dirty && !saving);

  if (id === undefined) {
    // Unreachable in practice — this component only mounts at
    // /knowledge/articles/:id — but useParams types id as possibly
    // undefined, so this satisfies that without an `!` assertion.
    return null;
  }

  if (loading) {
    return <Spinner label="Loading article…" />;
  }

  if (loadError !== null) {
    return <ErrorBanner error={loadError} />;
  }

  return (
    <div className="stack">
      <div className="row row--between">
        <Link to="/knowledge">← Knowledge base</Link>
        {dirty && <span className="text-muted">Unsaved changes</span>}
      </div>

      <div className="field">
        <label htmlFor="article-editor-title">Title</label>
        <input
          id="article-editor-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      <div className="row">
        <div className="field">
          <label htmlFor="article-editor-category">Category</label>
          <select
            id="article-editor-category"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.title}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="article-editor-status">Status</label>
          <select
            id="article-editor-status"
            value={status}
            onChange={(e) => setStatus(e.target.value === 'published' ? 'published' : 'draft')}
          >
            <option value="draft">Draft</option>
            <option value="published">Published</option>
          </select>
        </div>
        <button
          type="button"
          className="btn btn--primary"
          disabled={saving || !dirty}
          onClick={() => void handleSave()}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {validationError !== null && (
        <p className="error-banner" role="alert">
          {validationError}
        </p>
      )}
      {saveError !== null && <ErrorBanner error={saveError} />}
      {uploadError !== null && (
        <p className="error-banner" role="alert">
          {uploadError}
        </p>
      )}

      <BlockList
        blocks={blocks}
        onChange={handleBlockChange}
        onMove={handleBlockMove}
        onDelete={handleBlockDelete}
      />

      {uploading !== null && (
        <div className="card" role="status">
          Uploading {uploading.fileName}… {uploading.progress}%
        </div>
      )}

      <AddBlockMenu
        onAdd={handleAddBlock}
        onPickPhoto={(file) => void handlePickPhoto(file)}
        disabled={uploading !== null}
      />

      {staleConflict && (
        <StaleArticleDialog
          changesJson={JSON.stringify(stripImageUrls(blocks), null, 2)}
          onReload={handleStaleReload}
        />
      )}

      {blocker.state === 'blocked' && (
        <ConfirmDialog
          title="Discard unsaved changes?"
          message="You have unsaved changes to this article. Leaving now will discard them."
          confirmLabel="Discard changes"
          danger
          onConfirm={() => blocker.proceed()}
          onCancel={() => blocker.reset()}
        />
      )}
    </div>
  );
}
