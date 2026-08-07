import { useState, type FormEvent } from 'react';
import { useApiClient } from '../../api/context.tsx';
import { useMutation } from '../../api/hooks.ts';
import { ErrorBanner } from '../../components/ErrorBanner.tsx';
import { Modal } from '../../components/Modal.tsx';
import type { QuickTip } from '../../types/api.ts';
import { QUICK_TIP_BODY_MAX, QUICK_TIP_BODY_MIN } from '../../types/limits.ts';

/**
 * Create and edit share one form (plan step 3), same shape as
 * AnnouncementFormModal. Reordering is handled separately by the move
 * up/down buttons in the list, not by this form — `sortOrder` is never an
 * input here.
 */
export function QuickTipFormModal({
  quickTip,
  onClose,
  onSaved,
}: {
  quickTip?: QuickTip | undefined;
  onClose: () => void;
  onSaved: (quickTip: QuickTip) => void;
}) {
  const api = useApiClient();
  const [body, setBody] = useState(quickTip?.body ?? '');
  const [validationError, setValidationError] = useState<string | null>(null);

  const { mutate, loading, error } = useMutation((trimmedBody: string) =>
    quickTip === undefined
      ? api.createQuickTip({ body: trimmedBody })
      : api.updateQuickTip(quickTip.id, { body: trimmedBody }),
  );

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setValidationError(null);

    const trimmed = body.trim();
    if (trimmed.length < QUICK_TIP_BODY_MIN || trimmed.length > QUICK_TIP_BODY_MAX) {
      setValidationError(
        `Body must be between ${String(QUICK_TIP_BODY_MIN)} and ${String(QUICK_TIP_BODY_MAX)} characters.`,
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
    <Modal title={quickTip === undefined ? 'New quick tip' : 'Edit quick tip'} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void handleSubmit(e)}>
        <div className="field">
          <label htmlFor="quick-tip-body">Body</label>
          <textarea
            id="quick-tip-body"
            rows={3}
            required
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <p className="field-hint">
            {body.trim().length} / {QUICK_TIP_BODY_MAX}
          </p>
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
