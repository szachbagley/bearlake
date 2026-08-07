import { Modal } from './Modal.tsx';

/**
 * The one confirmation UI every destructive action goes through (plan step
 * 3, CLAUDE.md "confirm before deleting"). `onConfirm` fires only from the
 * confirm button — Escape, the overlay, and the Cancel button all route
 * through `onCancel` instead, so a caller's destructive action can never run
 * from anything but a deliberate click.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  danger = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal title={title} onClose={onCancel}>
      <div className="stack">
        <p>{message}</p>
        <div className="row">
          <button
            type="button"
            className={danger ? 'btn btn--danger' : 'btn btn--primary'}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
          <button type="button" className="btn btn--ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}
