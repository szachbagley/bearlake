import { useState, type FormEvent } from 'react';
import { useMutation } from '../../api/hooks.ts';
import { useApiClient } from '../../api/context.tsx';
import { ErrorBanner } from '../../components/ErrorBanner.tsx';
import { Modal } from '../../components/Modal.tsx';
import type { Announcement } from '../../types/api.ts';
import { ANNOUNCEMENT_BODY_MAX, ANNOUNCEMENT_BODY_MIN } from '../../types/limits.ts';
import { formatInstant } from '../../utils/dates.ts';

/**
 * Create and edit share one form (plan step 1): `announcement` present means
 * edit mode, pre-filling the body and showing (never an input for) the
 * fixed `postedAt` (plan step 2, server D18) — the request body only ever
 * carries `body` (plan W11), on create or edit alike.
 */
export function AnnouncementFormModal({
  announcement,
  onClose,
  onSaved,
}: {
  announcement?: Announcement | undefined;
  onClose: () => void;
  onSaved: (announcement: Announcement) => void;
}) {
  const api = useApiClient();
  const [body, setBody] = useState(announcement?.body ?? '');
  const [validationError, setValidationError] = useState<string | null>(null);

  const { mutate, loading, error } = useMutation((trimmedBody: string) =>
    announcement === undefined
      ? api.createAnnouncement({ body: trimmedBody })
      : api.updateAnnouncement(announcement.id, { body: trimmedBody }),
  );

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setValidationError(null);

    const trimmed = body.trim();
    if (trimmed.length < ANNOUNCEMENT_BODY_MIN || trimmed.length > ANNOUNCEMENT_BODY_MAX) {
      setValidationError(
        `Body must be between ${String(ANNOUNCEMENT_BODY_MIN)} and ${String(ANNOUNCEMENT_BODY_MAX)} characters.`,
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
    <Modal title={announcement === undefined ? 'New announcement' : 'Edit announcement'} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void handleSubmit(e)}>
        {announcement !== undefined && (
          <p className="field-hint">Posted {formatInstant(announcement.postedAt)}</p>
        )}
        <div className="field">
          <label htmlFor="announcement-body">Body</label>
          <textarea
            id="announcement-body"
            rows={6}
            required
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <p className="field-hint">
            {body.trim().length} / {ANNOUNCEMENT_BODY_MAX}
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
