import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../../api/client.ts';
import { useApiClient } from '../../api/context.tsx';
import { useMutation } from '../../api/hooks.ts';
import { ConfirmDialog } from '../../components/ConfirmDialog.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { ErrorBanner } from '../../components/ErrorBanner.tsx';
import { Spinner } from '../../components/Spinner.tsx';
import type { ArticleSummary, InfoCategory } from '../../types/api.ts';
import { NewArticleModal } from './NewArticleModal.tsx';

/**
 * A single category's articles (plan step 3): status badges — admins see
 * both draft and published (the server returns both for an admin caller,
 * plan D22) — move up/down, delete behind confirm. There's no single-
 * category GET endpoint, so the category's own title comes from the same
 * list the categories page uses.
 */
export function CategoryPage() {
  const { id } = useParams<{ id: string }>();
  const api = useApiClient();
  const navigate = useNavigate();

  const [category, setCategory] = useState<InfoCategory | null>(null);
  const [articles, setArticles] = useState<ArticleSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ArticleSummary | null>(null);
  const [reordering, setReordering] = useState(false);
  const [reorderError, setReorderError] = useState<unknown>(null);

  const deleteMutation = useMutation(api.deleteArticle);

  const loadData = useCallback(async () => {
    if (id === undefined) return;
    setLoading(true);
    setError(null);
    try {
      const [{ categories }, { articles: loadedArticles }] = await Promise.all([
        api.listCategories(),
        api.listArticlesByCategory(id),
      ]);
      setCategory(categories.find((c) => c.id === id) ?? null);
      setArticles(loadedArticles);
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [api, id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadData();
  }, [loadData]);

  async function handleConfirmDelete(): Promise<void> {
    if (pendingDelete === null) return;
    const article = pendingDelete;
    setPendingDelete(null);
    try {
      await deleteMutation.mutate(article.id);
      void loadData();
    } catch {
      // error state is already recorded on the mutation; nothing else to do here.
    }
  }

  async function move(index: number, direction: -1 | 1): Promise<void> {
    const neighborIndex = index + direction;
    const current = articles[index];
    const neighbor = articles[neighborIndex];
    if (current === undefined || neighbor === undefined) return;

    setReordering(true);
    setReorderError(null);
    try {
      await Promise.all([
        api.updateArticle(current.id, { sortOrder: neighbor.sortOrder, updatedAt: current.updatedAt }),
        api.updateArticle(neighbor.id, { sortOrder: current.sortOrder, updatedAt: neighbor.updatedAt }),
      ]);
      void loadData();
    } catch (err) {
      setReorderError(err);
    } finally {
      setReordering(false);
    }
  }

  if (id === undefined) {
    // Unreachable in practice — this component only ever mounts at
    // /knowledge/categories/:id — but useParams types id as possibly
    // undefined, so this satisfies that without an `!` assertion.
    return null;
  }

  return (
    <div className="stack">
      <Link to="/knowledge">← Knowledge base</Link>
      <div className="row row--between">
        <h1>{category?.title ?? 'Category'}</h1>
        <button type="button" className="btn btn--primary" onClick={() => setCreating(true)}>
          New article
        </button>
      </div>

      {error !== null && <ErrorBanner error={error} />}
      {reorderError !== null && <ErrorBanner error={reorderError} />}
      {deleteMutation.error !== null && <ErrorBanner error={deleteMutation.error} />}

      {loading ? (
        <Spinner label="Loading articles…" />
      ) : articles.length === 0 ? (
        <EmptyState message="No articles yet." />
      ) : (
        <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {articles.map((article, index) => (
            <li key={article.id} className="card row row--between">
              <span className="row">
                <span
                  className={article.status === 'published' ? 'badge badge--published' : 'badge badge--draft'}
                >
                  {article.status === 'published' ? 'Published' : 'Draft'}
                </span>
                <Link to={`/knowledge/articles/${article.id}`}>{article.title}</Link>
              </span>
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
                  disabled={reordering || index === articles.length - 1}
                  onClick={() => void move(index, 1)}
                >
                  ↓
                </button>
                <button type="button" className="btn btn--ghost" onClick={() => setPendingDelete(article)}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {creating && (
        <NewArticleModal
          categoryId={id}
          onClose={() => setCreating(false)}
          onCreated={(article) => void navigate(`/knowledge/articles/${article.id}`)}
        />
      )}

      {pendingDelete !== null && (
        <ConfirmDialog
          title="Delete article?"
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
