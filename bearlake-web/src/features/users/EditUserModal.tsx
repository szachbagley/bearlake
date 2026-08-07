import { useState, type FormEvent } from 'react';
import { useApiClient } from '../../api/context.tsx';
import { useMutation } from '../../api/hooks.ts';
import { ConfirmDialog } from '../../components/ConfirmDialog.tsx';
import { ErrorBanner } from '../../components/ErrorBanner.tsx';
import { Modal } from '../../components/Modal.tsx';
import type { PublicUser, UpdateUserRequest, UserRole } from '../../types/api.ts';
import { USER_DISPLAY_NAME_MAX, USER_DISPLAY_NAME_MIN } from '../../types/limits.ts';

function isUserRole(value: string): value is UserRole {
  return value === 'admin' || value === 'member';
}

const SELF_CONTROLS_DISABLED_REASON =
  "You can't change your own role or active status — the server refuses this even if you try.";

/**
 * The one edit form (plan step 3): display name, role, and the active
 * toggle together. Turning a currently-active user off routes through a
 * confirmation step (plan step 3, "Deactivation is confirmed...") before the
 * PATCH actually fires; canceling reverts the toggle rather than leaving the
 * form in a half-confirmed state. Turning a user back on needs no
 * confirmation — it isn't destructive.
 *
 * `isSelf` disables the role and active controls (plan step 5): the server
 * refuses an admin changing their own role or active status (403), so
 * presenting a control that cannot succeed would just be a trap.
 */
export function EditUserModal({
  user,
  isSelf,
  onClose,
  onSaved,
}: {
  user: PublicUser;
  isSelf: boolean;
  onClose: () => void;
  onSaved: (user: PublicUser) => void;
}) {
  const api = useApiClient();
  const [displayName, setDisplayName] = useState(user.displayName);
  const [role, setRole] = useState<UserRole>(user.role);
  const [isActive, setIsActive] = useState(user.isActive);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [confirmingDeactivate, setConfirmingDeactivate] = useState(false);

  const { mutate, loading, error } = useMutation((patch: UpdateUserRequest) =>
    api.updateUser(user.id, patch),
  );

  function buildPatch(trimmedName: string): UpdateUserRequest {
    const patch: UpdateUserRequest = {};
    if (trimmedName !== user.displayName) patch.displayName = trimmedName;
    if (role !== user.role) patch.role = role;
    if (isActive !== user.isActive) patch.isActive = isActive;
    return patch;
  }

  async function submit(patch: UpdateUserRequest): Promise<void> {
    try {
      const result = await mutate(patch);
      onSaved(result);
    } catch {
      // error state is already recorded on the mutation; nothing else to do here.
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setValidationError(null);

    const trimmedName = displayName.trim();
    if (trimmedName.length < USER_DISPLAY_NAME_MIN || trimmedName.length > USER_DISPLAY_NAME_MAX) {
      setValidationError(
        `Display name must be between ${String(USER_DISPLAY_NAME_MIN)} and ${String(USER_DISPLAY_NAME_MAX)} characters.`,
      );
      return;
    }

    const patch = buildPatch(trimmedName);
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }

    if (user.isActive && !isActive) {
      setConfirmingDeactivate(true);
      return;
    }

    await submit(patch);
  }

  if (confirmingDeactivate) {
    return (
      <ConfirmDialog
        title="Deactivate this user?"
        message="They'll be signed out immediately and won't be able to sign in again until reactivated. Their past activity is kept — accounts are never deleted."
        confirmLabel="Deactivate"
        danger
        onConfirm={() => {
          setConfirmingDeactivate(false);
          void submit(buildPatch(displayName.trim()));
        }}
        onCancel={() => {
          setConfirmingDeactivate(false);
          setIsActive(true);
        }}
      />
    );
  }

  return (
    <Modal title="Edit user" onClose={onClose}>
      <form className="stack" onSubmit={(e) => void handleSubmit(e)}>
        <div className="field">
          <label htmlFor="edit-user-display-name">Display name</label>
          <input
            id="edit-user-display-name"
            type="text"
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="edit-user-role">Role</label>
          <select
            id="edit-user-role"
            value={role}
            disabled={isSelf}
            title={isSelf ? SELF_CONTROLS_DISABLED_REASON : undefined}
            onChange={(e) => {
              if (isUserRole(e.target.value)) setRole(e.target.value);
            }}
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <label className="row" title={isSelf ? SELF_CONTROLS_DISABLED_REASON : undefined}>
          <input
            type="checkbox"
            style={{ width: 'auto' }}
            checked={isActive}
            disabled={isSelf}
            onChange={(e) => setIsActive(e.target.checked)}
          />
          Active
        </label>
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
