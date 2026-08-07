import { useState, type FormEvent } from 'react';
import { ApiError } from '../../api/client.ts';
import { useApiClient } from '../../api/context.tsx';
import { useMutation } from '../../api/hooks.ts';
import { ErrorBanner } from '../../components/ErrorBanner.tsx';
import { Modal } from '../../components/Modal.tsx';
import type { CreateUserResponse, UserRole } from '../../types/api.ts';
import { USER_DISPLAY_NAME_MAX, USER_DISPLAY_NAME_MIN } from '../../types/limits.ts';

function isUserRole(value: string): value is UserRole {
  return value === 'admin' || value === 'member';
}

/**
 * Create only — there is no user-editing form here, just this and
 * EditUserModal (plan step 2). On success the caller shows
 * TempPasswordModal with the returned one-time password (plan W31) and
 * reloads the list; this component never sees the password again once it
 * calls `onCreated`.
 */
export function CreateUserModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (result: CreateUserResponse) => void;
}) {
  const api = useApiClient();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('member');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);

  const { mutate, loading, error } = useMutation(api.createUser);

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setValidationError(null);
    setEmailError(null);

    const trimmedName = displayName.trim();
    if (trimmedName.length < USER_DISPLAY_NAME_MIN || trimmedName.length > USER_DISPLAY_NAME_MAX) {
      setValidationError(
        `Display name must be between ${String(USER_DISPLAY_NAME_MIN)} and ${String(USER_DISPLAY_NAME_MAX)} characters.`,
      );
      return;
    }

    try {
      const result = await mutate({ displayName: trimmedName, email: email.trim(), role });
      onCreated(result);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'EMAIL_IN_USE') {
        setEmailError(err.message);
      }
    }
  }

  return (
    <Modal title="New user" onClose={onClose}>
      <form className="stack" onSubmit={(e) => void handleSubmit(e)}>
        <div className="field">
          <label htmlFor="new-user-display-name">Display name</label>
          <input
            id="new-user-display-name"
            type="text"
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="new-user-email">Email</label>
          <input
            id="new-user-email"
            type="email"
            autoComplete="off"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {emailError !== null && (
            <p className="error" role="alert">
              {emailError}
            </p>
          )}
        </div>
        <div className="field">
          <label htmlFor="new-user-role">Role</label>
          <select
            id="new-user-role"
            value={role}
            onChange={(e) => {
              if (isUserRole(e.target.value)) setRole(e.target.value);
            }}
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        {validationError !== null && (
          <p className="error-banner" role="alert">
            {validationError}
          </p>
        )}
        {error !== null && error.code !== 'EMAIL_IN_USE' && <ErrorBanner error={error} />}
        <div className="row">
          <button type="submit" className="btn btn--primary" disabled={loading}>
            {loading ? 'Creating…' : 'Create user'}
          </button>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
