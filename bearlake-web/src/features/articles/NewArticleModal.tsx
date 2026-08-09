import { useState, type FormEvent } from 'react';
import { useApiClient } from '../../api/context.tsx';
import { useMutation } from '../../api/hooks.ts';
import { ErrorBanner } from '../../components/ErrorBanner.tsx';
import { Modal } from '../../components/Modal.tsx';
import type { InfoArticle } from '../../types/api.ts';
import { ARTICLE_TITLE_MAX, ARTICLE_TITLE_MIN } from '../../types/limits.ts';

/**
 * Draft-first creation (plan W21, step 4): collects just the title — the
 * category comes from the page this modal is opened from — and immediately
 * creates a `draft` with no blocks, then hands the full article back so the
 * caller can navigate to `/knowledge/articles/:id`. Block editing (Phase 8)
 * only ever happens against a persisted article; this never opens an editor
 * on an unsaved one.
 */
export function NewArticleModal({
  categoryId,
  onClose,
  onCreated,
}: {
  categoryId: string;
  onClose: () => void;
  onCreated: (article: InfoArticle) => void;
}) {
  const api = useApiClient();
  const [title, setTitle] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const { mutate, loading, error } = useMutation((trimmedTitle: string) =>
    api.createArticle({ categoryId, title: trimmedTitle, blocks: [], status: 'draft' }),
  );

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setValidationError(null);

    const trimmed = title.trim();
    if (trimmed.length < ARTICLE_TITLE_MIN || trimmed.length > ARTICLE_TITLE_MAX) {
      setValidationError(
        `Title must be between ${String(ARTICLE_TITLE_MIN)} and ${String(ARTICLE_TITLE_MAX)} characters.`,
      );
      return;
    }

    try {
      const result = await mutate(trimmed);
      onCreated(result);
    } catch {
      // error state is already recorded on the mutation; nothing else to do here.
    }
  }

  return (
    <Modal title="New article" onClose={onClose}>
      <form className="stack" onSubmit={(e) => void handleSubmit(e)}>
        <div className="field">
          <label htmlFor="article-title">Title</label>
          <input
            id="article-title"
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        {validationError !== null && (
          <p className="error-banner" role="alert">
            {validationError}
          </p>
        )}
        {error !== null && <ErrorBanner error={error} />}
        <div className="row">
          <button type="submit" className="btn btn--primary" disabled={loading}>
            {loading ? 'Creating…' : 'Create'}
          </button>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
