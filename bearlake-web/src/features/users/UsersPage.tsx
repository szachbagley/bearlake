import { useCallback, useState } from 'react';
import { useApiClient } from '../../api/context.tsx';
import { useMutation, useQuery } from '../../api/hooks.ts';
import { useAuth } from '../../auth/AuthProvider.tsx';
import { ConfirmDialog } from '../../components/ConfirmDialog.tsx';
import { ErrorBanner } from '../../components/ErrorBanner.tsx';
import { Spinner } from '../../components/Spinner.tsx';
import type { PublicUser } from '../../types/api.ts';
import { formatInstant, formatRelativeTime } from '../../utils/dates.ts';
import { CreateUserModal } from './CreateUserModal.tsx';
import { EditUserModal } from './EditUserModal.tsx';
import { TempPasswordModal } from './TempPasswordModal.tsx';

type EditState = 'closed' | 'create' | PublicUser;

/**
 * The only surface for user management (CLAUDE.md) and the only screen
 * handling a plaintext credential (plan W31) — every path that can produce
 * one routes through TempPasswordModal and nothing else ever holds it.
 */
export function UsersPage() {
  const api = useApiClient();
  const { user: currentUser } = useAuth();
  const listUsers = useCallback((signal: AbortSignal) => api.listUsers({ signal }), [api]);
  const { data, error, loading, refetch } = useQuery(listUsers);
  const users = data?.users ?? [];

  const [editState, setEditState] = useState<EditState>('closed');
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [pendingReset, setPendingReset] = useState<PublicUser | null>(null);
  const resetMutation = useMutation(api.resetUserPassword);

  function handleCreated(result: { user: PublicUser; temporaryPassword: string }): void {
    setEditState('closed');
    setTempPassword(result.temporaryPassword);
    refetch();
  }

  function handleSaved(): void {
    setEditState('closed');
    refetch();
  }

  async function handleConfirmReset(): Promise<void> {
    if (pendingReset === null) return;
    const id = pendingReset.id;
    setPendingReset(null);
    try {
      const result = await resetMutation.mutate(id);
      setTempPassword(result.temporaryPassword);
    } catch {
      // error state is already recorded on the mutation; nothing else to do here.
    }
  }

  return (
    <div className="stack">
      <div className="row row--between">
        <h1>Users</h1>
        <button type="button" className="btn btn--primary" onClick={() => setEditState('create')}>
          New user
        </button>
      </div>

      {error !== null && <ErrorBanner error={error} />}
      {resetMutation.error !== null && <ErrorBanner error={resetMutation.error} />}

      {loading ? (
        <Spinner label="Loading users…" />
      ) : (
        <table>
          <thead>
            <tr>
              <th>Display name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Last login</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const isSelf = user.id === currentUser?.id;
              return (
                <tr key={user.id} style={user.isActive ? undefined : { opacity: 0.55 }}>
                  <td>
                    {user.displayName}
                    {isSelf && <span className="text-muted"> (you)</span>}
                  </td>
                  <td>{user.email}</td>
                  <td>{user.role}</td>
                  <td>{user.isActive ? 'Active' : 'Deactivated'}</td>
                  <td>
                    {user.lastLoginAt === null ? (
                      'Never'
                    ) : (
                      <span title={formatInstant(user.lastLoginAt)}>
                        {formatRelativeTime(user.lastLoginAt)}
                      </span>
                    )}
                  </td>
                  <td>
                    <div className="row">
                      <button
                        type="button"
                        className="btn btn--ghost"
                        onClick={() => setEditState(user)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost"
                        onClick={() => setPendingReset(user)}
                      >
                        Reset password
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {editState === 'create' && (
        <CreateUserModal onClose={() => setEditState('closed')} onCreated={handleCreated} />
      )}

      {editState !== 'closed' && editState !== 'create' && (
        <EditUserModal
          user={editState}
          isSelf={editState.id === currentUser?.id}
          onClose={() => setEditState('closed')}
          onSaved={handleSaved}
        />
      )}

      {pendingReset !== null && (
        <ConfirmDialog
          title="Reset this user's password?"
          message={`This immediately signs ${pendingReset.displayName} out everywhere. They'll need the new temporary password to sign back in.`}
          confirmLabel="Reset password"
          danger
          onConfirm={() => void handleConfirmReset()}
          onCancel={() => setPendingReset(null)}
        />
      )}

      {tempPassword !== null && (
        <TempPasswordModal password={tempPassword} onClose={() => setTempPassword(null)} />
      )}
    </div>
  );
}
