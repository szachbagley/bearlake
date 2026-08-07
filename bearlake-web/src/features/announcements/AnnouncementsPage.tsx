import { useCallback, useEffect, useState } from 'react';
import { useApiClient } from '../../api/context.tsx';
import { ApiError } from '../../api/client.ts';
import { useMutation } from '../../api/hooks.ts';
import { ConfirmDialog } from '../../components/ConfirmDialog.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { ErrorBanner } from '../../components/ErrorBanner.tsx';
import { Spinner } from '../../components/Spinner.tsx';
import type { Announcement } from '../../types/api.ts';
import { formatInstant } from '../../utils/dates.ts';
import { AnnouncementFormModal } from './AnnouncementFormModal.tsx';

type FormState = 'closed' | 'create' | Announcement;

/**
 * Reverse-chronological, "Load more"-paginated (plan step 1). Every
 * create/edit/delete resets back to the first page rather than patching the
 * in-memory list — simplest thing that keeps the list actually
 * reverse-chronological after a mutation, and matches the no-cache
 * philosophy (plan W3): a mutation is always followed by a real refetch.
 */
export function AnnouncementsPage() {
  const api = useApiClient();
  const [items, setItems] = useState<Announcement[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [formState, setFormState] = useState<FormState>('closed');
  const [pendingDelete, setPendingDelete] = useState<Announcement | null>(null);

  const deleteMutation = useMutation(api.deleteAnnouncement);

  const loadFirstPage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await api.listAnnouncements({});
      setItems(page.items);
      setNextCursor(page.nextCursor);
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    // Same documented data-fetching pattern as api/hooks.ts's useQuery
    // (mount-time fetch, setState on the result) — this page can't use
    // useQuery itself since it needs to accumulate pages across "Load
    // more", not just hold the latest queryFn result.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadFirstPage();
  }, [loadFirstPage]);

  async function loadMore(): Promise<void> {
    if (nextCursor === null) return;
    setLoadingMore(true);
    try {
      const page = await api.listAnnouncements({ cursor: nextCursor });
      setItems((prev) => [...prev, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      setError(err);
    } finally {
      setLoadingMore(false);
    }
  }

  function handleSaved(): void {
    setFormState('closed');
    void loadFirstPage();
  }

  async function handleConfirmDelete(): Promise<void> {
    if (pendingDelete === null) return;
    const id = pendingDelete.id;
    setPendingDelete(null);
    await deleteMutation.mutate(id);
    void loadFirstPage();
  }

  return (
    <div className="stack">
      <div className="row row--between">
        <h1>Announcements</h1>
        <button type="button" className="btn btn--primary" onClick={() => setFormState('create')}>
          New announcement
        </button>
      </div>

      {error !== null && <ErrorBanner error={error} />}
      {deleteMutation.error !== null && <ErrorBanner error={deleteMutation.error} />}

      {loading ? (
        <Spinner label="Loading announcements…" />
      ) : items.length === 0 ? (
        <EmptyState message="No announcements yet." />
      ) : (
        <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {items.map((announcement) => (
            <li key={announcement.id} className="card stack">
              <div className="row row--between">
                <span className="text-muted">{formatInstant(announcement.postedAt)}</span>
                <div className="row">
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => setFormState(announcement)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => setPendingDelete(announcement)}
                  >
                    Delete
                  </button>
                </div>
              </div>
              <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{announcement.body}</p>
            </li>
          ))}
        </ul>
      )}

      {!loading && nextCursor !== null && (
        <button type="button" className="btn" disabled={loadingMore} onClick={() => void loadMore()}>
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      )}

      {formState !== 'closed' && (
        <AnnouncementFormModal
          announcement={formState === 'create' ? undefined : formState}
          onClose={() => setFormState('closed')}
          onSaved={handleSaved}
        />
      )}

      {pendingDelete !== null && (
        <ConfirmDialog
          title="Delete announcement?"
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
