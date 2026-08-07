import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client.ts';
import { useAuth } from './AuthProvider.tsx';

const MIN_PASSWORD_LENGTH = 12;

/**
 * Serves both flows off one component (plan step 5): `forced` is derived
 * from `user.mustChangePassword`, not passed in, so there is exactly one
 * source of truth for which mode applies. Forced is non-dismissable — no
 * cancel, no nav; voluntary gets a way back out.
 */
export function ChangePasswordPage() {
  const { user, changePassword } = useAuth();
  const navigate = useNavigate();
  const forced = user?.mustChangePassword === true;

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [succeeded, setSucceeded] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`Your new password must be at least ${String(MIN_PASSWORD_LENGTH)} characters.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('The passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      await changePassword(currentPassword, newPassword);
      setSucceeded(true);
    } catch (err) {
      // Verbatim (plan step 5): the server writes every message here to be
      // safely shown to a user, VALIDATION_ERROR most commonly but not only.
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (succeeded && !forced) {
    return (
      <main className="stack" style={{ maxWidth: '20rem', margin: '4rem auto' }}>
        <h1>Password changed</h1>
        <p className="success-banner">Your password has been changed.</p>
        {/* navigate(-1), not a fixed route: this page is reachable from
         * anywhere in the guarded layout, and going back to wherever the
         * admin came from is simpler than assuming one. */}
        <button type="button" className="btn" onClick={() => void navigate(-1)}>
          Done
        </button>
      </main>
    );
  }

  return (
    <main className="stack" style={{ maxWidth: '20rem', margin: '4rem auto' }}>
      <h1>Change your password</h1>
      {forced && (
        <p className="field-hint">
          You must choose a new password before continuing.
        </p>
      )}
      <form className="stack" onSubmit={(e) => void handleSubmit(e)}>
        <div className="field">
          <label htmlFor="current-password">Current password</label>
          <input
            id="current-password"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="new-password">New password</label>
          <input
            id="new-password"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            required
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="confirm-password">Confirm new password</label>
          <input
            id="confirm-password"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </div>
        {error !== null && (
          <p className="error-banner" role="alert">
            {error}
          </p>
        )}
        <div className="row">
          <button type="submit" className="btn btn--primary" disabled={submitting}>
            {submitting ? 'Changing…' : 'Change password'}
          </button>
          {!forced && (
            <button type="button" className="btn btn--ghost" onClick={() => void navigate(-1)}>
              Cancel
            </button>
          )}
        </div>
      </form>
    </main>
  );
}
