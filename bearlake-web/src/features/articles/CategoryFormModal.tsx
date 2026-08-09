import { useState, type FormEvent } from 'react';
import { useApiClient } from '../../api/context.tsx';
import { useMutation } from '../../api/hooks.ts';
import { ErrorBanner } from '../../components/ErrorBanner.tsx';
import { Modal } from '../../components/Modal.tsx';
import type { InfoCategory } from '../../types/api.ts';
import { CATEGORY_TITLE_MAX, CATEGORY_TITLE_MIN } from '../../types/limits.ts';

/** Create and rename share one form (plan step 1) — a category is just a
 * title; `sortOrder` is never an input here, only set by create (append) or
 * the move up/down buttons in the list. */
export function CategoryFormModal({
  category,
  onClose,
  onSaved,
}: {
  category?: InfoCategory | undefined;
  onClose: () => void;
  onSaved: (category: InfoCategory) => void;
}) {
  const api = useApiClient();
  const [title, setTitle] = useState(category?.title ?? '');
  const [validationError, setValidationError] = useState<string | null>(null);

  const { mutate, loading, error } = useMutation((trimmedTitle: string) =>
    category === undefined
      ? api.createCategory({ title: trimmedTitle })
      : api.updateCategory(category.id, { title: trimmedTitle }),
  );

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setValidationError(null);

    const trimmed = title.trim();
    if (trimmed.length < CATEGORY_TITLE_MIN || trimmed.length > CATEGORY_TITLE_MAX) {
      setValidationError(
        `Title must be between ${String(CATEGORY_TITLE_MIN)} and ${String(CATEGORY_TITLE_MAX)} characters.`,
      );
      return;
    }

    try {
      const result = await mutate(trimmed);
      onSaved(result);
    } catch {
      // error state is already recorded on the mutation; nothing else to do here.
    }
  }

  return (
    <Modal title={category === undefined ? 'New category' : 'Rename category'} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void handleSubmit(e)}>
        <div className="field">
          <label htmlFor="category-title">Title</label>
          <input
            id="category-title"
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
            {loading ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
