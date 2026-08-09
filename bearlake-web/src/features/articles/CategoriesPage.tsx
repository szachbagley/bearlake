import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../../api/client.ts';
import { useApiClient } from '../../api/context.tsx';
import { useMutation } from '../../api/hooks.ts';
import { ConfirmDialog } from '../../components/ConfirmDialog.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { ErrorBanner } from '../../components/ErrorBanner.tsx';
import { Spinner } from '../../components/Spinner.tsx';
import type { InfoCategory } from '../../types/api.ts';
import { CategoryFormModal } from './CategoryFormModal.tsx';

type FormState = 'closed' | 'create' | InfoCategory;

/** Categories list (plan step 1): title, article count, create/rename,
 * move up/down (a `sortOrder` swap with the adjacent category, same
 * pattern as Phase 4's quick tips), delete behind confirm. The list
 * endpoint doesn't return article counts, so this loads each category's
 * article list once alongside it — categories are few, so this stays a
 * bounded, one-time fetch rather than anything unbounded. */
export function CategoriesPage() {
  const api = useApiClient();
  const [categories, setCategories] = useState<InfoCategory[]>([]);
  const [articleCounts, setArticleCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [formState, setFormState] = useState<FormState>('closed');
  const [pendingDelete, setPendingDelete] = useState<InfoCategory | null>(null);
  const [reordering, setReordering] = useState(false);
  const [reorderError, setReorderError] = useState<unknown>(null);

  const deleteMutation = useMutation(api.deleteCategory);

  const loadCategories = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { categories: loaded } = await api.listCategories();
      const counts = await Promise.all(
        loaded.map((category) => api.listArticlesByCategory(category.id).then((r) => r.articles.length)),
      );
      setCategories(loaded);
      setArticleCounts(Object.fromEntries(loaded.map((c, i) => [c.id, counts[i] ?? 0])));
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadCategories();
  }, [loadCategories]);

  function handleSaved(): void {
    setFormState('closed');
    void loadCategories();
  }

  async function handleConfirmDelete(): Promise<void> {
    if (pendingDelete === null) return;
    const category = pendingDelete;
    setPendingDelete(null);
    try {
      await deleteMutation.mutate(category.id);
      void loadCategories();
    } catch {
      // error state is already recorded on the mutation and surfaced via
      // ErrorBanner below — the server's own message is specific enough
      // (e.g. CATEGORY_NOT_EMPTY's "move or delete this category's
      // articles first", plan step 2) without special-casing the code here.
    }
  }

  async function move(index: number, direction: -1 | 1): Promise<void> {
    const neighborIndex = index + direction;
    const current = categories[index];
    const neighbor = categories[neighborIndex];
    if (current === undefined || neighbor === undefined) return;

    setReordering(true);
    setReorderError(null);
    try {
      await Promise.all([
        api.updateCategory(current.id, { sortOrder: neighbor.sortOrder }),
        api.updateCategory(neighbor.id, { sortOrder: current.sortOrder }),
      ]);
      void loadCategories();
    } catch (err) {
      setReorderError(err);
    } finally {
      setReordering(false);
    }
  }

  return (
    <div className="stack">
      <div className="row row--between">
        <h1>Knowledge base</h1>
        <button type="button" className="btn btn--primary" onClick={() => setFormState('create')}>
          New category
        </button>
      </div>

      {error !== null && <ErrorBanner error={error} />}
      {reorderError !== null && <ErrorBanner error={reorderError} />}
      {deleteMutation.error !== null && <ErrorBanner error={deleteMutation.error} />}

      {loading ? (
        <Spinner label="Loading categories…" />
      ) : categories.length === 0 ? (
        <EmptyState message="No categories yet." />
      ) : (
        <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {categories.map((category, index) => (
            <li key={category.id} className="card row row--between">
              <Link to={`/knowledge/categories/${category.id}`}>
                {category.title}{' '}
                <span className="text-muted">
                  ({articleCounts[category.id] ?? 0} article{articleCounts[category.id] === 1 ? '' : 's'})
                </span>
              </Link>
              <div className="row">
                <button
                  type="button"
                  className="btn btn--ghost"
                  aria-label="Move up"
                  disabled={reordering || index === 0}
                  onClick={() => void move(index, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  aria-label="Move down"
                  disabled={reordering || index === categories.length - 1}
                  onClick={() => void move(index, 1)}
                >
                  ↓
                </button>
                <button type="button" className="btn btn--ghost" onClick={() => setFormState(category)}>
                  Rename
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => setPendingDelete(category)}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {formState !== 'closed' && (
        <CategoryFormModal
          category={formState === 'create' ? undefined : formState}
          onClose={() => setFormState('closed')}
          onSaved={handleSaved}
        />
      )}

      {pendingDelete !== null && (
        <ConfirmDialog
          title="Delete category?"
          message="This cannot be undone."
          confirmLabel="Delete"
          danger
          onConfirm={() => void handleConfirmDelete()}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
