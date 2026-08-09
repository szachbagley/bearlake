import { CopyButton } from '../../components/CopyButton.tsx';
import { Modal } from '../../components/Modal.tsx';

/**
 * Shown after `createUser` or `resetUserPassword` (plan W31) — the only two
 * responses in the system carrying a plaintext credential. `password` lives
 * only in the caller's React state and is discarded on dismiss; it is never
 * written to `sessionStorage`, `localStorage`, a URL, or logged anywhere.
 */
export function TempPasswordModal({
  password,
  onClose,
}: {
  password: string;
  onClose: () => void;
}) {
  return (
    <Modal title="Temporary password" onClose={onClose}>
      <div className="stack">
        <p>
          Share this password with the user through a different channel (text, in person). It
          will not be shown again.
        </p>
        <p
          className="card"
          style={{ fontFamily: 'var(--font-mono)', fontSize: '1.125rem', wordBreak: 'break-all' }}
        >
          {password}
        </p>
        <div className="row">
          <CopyButton value={password} label="Copy password" />
          <button type="button" className="btn btn--primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </Modal>
  );
}
