import { useCallback, useState } from 'react';
import { useApiClient } from '../../api/context.tsx';
import { useMutation, useQuery } from '../../api/hooks.ts';
import { ConfirmDialog } from '../../components/ConfirmDialog.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { ErrorBanner } from '../../components/ErrorBanner.tsx';
import { Spinner } from '../../components/Spinner.tsx';
import type { QuickTip } from '../../types/api.ts';
import { QuickTipFormModal } from './QuickTipFormModal.tsx';

type FormState = 'closed' | 'create' | QuickTip;

/**
 * Ordered by `sortOrder` (the server already returns them that way — plan
 * step 3). Move up/down swaps `sortOrder` between the tip and its neighbor
 * via two PATCH calls, sending only `{ sortOrder }` each time (plan W11);
 * there is no bulk-reorder endpoint, and the column isn't unique, so a
 * plain swap is enough to reorder without touching anything else.
 */
export function QuickTipsPage() {
  const api = useApiClient();
  const listQuickTips = useCallback((signal: AbortSignal) => api.listQuickTips({ signal }), [api]);
  const { data, error, loading, refetch } = useQuery(listQuickTips);
  const quickTips = data?.quickTips ?? [];

  const [formState, setFormState] = useState<FormState>('closed');
  const [pendingDelete, setPendingDelete] = useState<QuickTip | null>(null);
  const [reordering, setReordering] = useState(false);
  const [reorderError, setReorderError] = useState<unknown>(null);

  const deleteMutation = useMutation(api.deleteQuickTip);

  function handleSaved(): void {
    setFormState('closed');
    refetch();
  }

  async function handleConfirmDelete(): Promise<void> {
    if (pendingDelete === null) return;
    const id = pendingDelete.id;
    setPendingDelete(null);
    await deleteMutation.mutate(id);
    refetch();
  }

  async function move(index: number, direction: -1 | 1): Promise<void> {
    const neighborIndex = index + direction;
    const current = quickTips[index];
    const neighbor = quickTips[neighborIndex];
    if (current === undefined || neighbor === undefined) return;

    setReordering(true);
    setReorderError(null);
    try {
      await Promise.all([
        api.updateQuickTip(current.id, { sortOrder: neighbor.sortOrder }),
        api.updateQuickTip(neighbor.id, { sortOrder: current.sortOrder }),
      ]);
      refetch();
    } catch (err) {
      setReorderError(err);
    } finally {
      setReordering(false);
    }
  }

  return (
    <div className="stack">
      <div className="row row--between">
        <h1>Quick tips</h1>
        <button type="button" className="btn btn--primary" onClick={() => setFormState('create')}>
          New quick tip
        </button>
      </div>

      {error !== null && <ErrorBanner error={error} />}
      {deleteMutation.error !== null && <ErrorBanner error={deleteMutation.error} />}
      {reorderError !== null && <ErrorBanner error={reorderError} />}

      {loading ? (
        <Spinner label="Loading quick tips…" />
      ) : quickTips.length === 0 ? (
        <EmptyState message="No quick tips yet." />
      ) : (
        <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {quickTips.map((tip, index) => (
            <li key={tip.id} className="card row row--between">
              <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{tip.body}</p>
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
                  disabled={reordering || index === quickTips.length - 1}
                  onClick={() => void move(index, 1)}
                >
                  ↓
                </button>
                <button type="button" className="btn btn--ghost" onClick={() => setFormState(tip)}>
                  Edit
                </button>
                <button type="button" className="btn btn--ghost" onClick={() => setPendingDelete(tip)}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {formState !== 'closed' && (
        <QuickTipFormModal
          quickTip={formState === 'create' ? undefined : formState}
          onClose={() => setFormState('closed')}
          onSaved={handleSaved}
        />
      )}

      {pendingDelete !== null && (
        <ConfirmDialog
          title="Delete quick tip?"
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
