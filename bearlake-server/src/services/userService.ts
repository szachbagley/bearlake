import {
  findUserByEmail,
  findUserById,
  insertUser,
  listUsers,
  resetUserPassword,
  updateUser,
  type UserUpdate,
} from '../db/queries/users.js';
import type { UserRole } from '../types/domain.js';
import { EmailInUseError, ForbiddenError, InternalError, NotFoundError } from '../types/errors.js';
import { generateTemporaryPassword, hashPassword } from './passwordService.js';
import { revokeAllSessions } from './tokenService.js';
import { type PublicUser, toPublicUser } from './userSerializer.js';

/**
 * Account administration (spec §3.2).
 *
 * There is no self-registration anywhere in the system: every function here
 * requires an admin caller, enforced by middleware on the routes.
 */

export interface CreatedUser {
  user: PublicUser;
  /**
   * Plaintext, returned exactly once and never recoverable. The admin relays
   * it out of band. It is not logged and not stored.
   */
  temporaryPassword: string;
}

function isDuplicateEmailError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 'ER_DUP_ENTRY';
}

export async function list(): Promise<PublicUser[]> {
  const users = await listUsers();
  return users.map(toPublicUser);
}

export async function get(id: string): Promise<PublicUser> {
  const user = await findUserById(id);
  if (user === null) {
    throw new NotFoundError('That account could not be found.');
  }
  return toPublicUser(user);
}

/**
 * Creates an account with a generated temporary password.
 *
 * The duplicate check is done twice: once explicitly for a clear error, and
 * once by catching the unique index violation, which closes the window between
 * the check and the insert. The index is the real guarantee — and because the
 * column collation is case-insensitive, it also rejects an address differing
 * only in case.
 */
export async function create(input: {
  displayName: string;
  email: string;
  role: UserRole;
}): Promise<CreatedUser> {
  const existing = await findUserByEmail(input.email);
  if (existing !== null) {
    throw new EmailInUseError();
  }

  const temporaryPassword = generateTemporaryPassword();

  try {
    const user = await insertUser({
      displayName: input.displayName,
      email: input.email,
      passwordHash: await hashPassword(temporaryPassword),
      role: input.role,
      mustChangePassword: true,
      isActive: true,
    });

    return { user: toPublicUser(user), temporaryPassword };
  } catch (err) {
    if (isDuplicateEmailError(err)) {
      throw new EmailInUseError();
    }
    throw err;
  }
}

/**
 * Updates an account.
 *
 * An admin may not demote or deactivate themselves. With two admins in
 * practice, a mistaken self-demotion could leave the family with no one able
 * to administer anything; the other admin can always do it deliberately.
 *
 * Deactivating revokes the account's sessions, so `isActive = false` ends
 * access immediately rather than at the next token expiry. A role change needs
 * no revocation — the role is read from the database on every request.
 */
export async function update(
  callerId: string,
  targetId: string,
  update_: UserUpdate,
): Promise<PublicUser> {
  const target = await findUserById(targetId);
  if (target === null) {
    throw new NotFoundError('That account could not be found.');
  }

  if (callerId === targetId) {
    if (update_.role !== undefined && update_.role !== target.role) {
      throw new ForbiddenError('You cannot change your own role.');
    }
    if (update_.isActive === false) {
      throw new ForbiddenError('You cannot deactivate your own account.');
    }
  }

  const updated = await updateUser(targetId, update_);
  if (updated === null) {
    throw new InternalError();
  }

  if (update_.isActive === false) {
    await revokeAllSessions(targetId, 'deactivated');
  }

  return toPublicUser(updated);
}

/**
 * Issues a new temporary password and forces a change on next sign-in.
 *
 * Existing sessions are revoked, so a reset genuinely locks the account until
 * the new password is used — otherwise a still-signed-in device would keep
 * working and the reset would be cosmetic.
 */
export async function resetPassword(targetId: string): Promise<{ temporaryPassword: string }> {
  const target = await findUserById(targetId);
  if (target === null) {
    throw new NotFoundError('That account could not be found.');
  }

  const temporaryPassword = generateTemporaryPassword();

  await resetUserPassword(targetId, await hashPassword(temporaryPassword));
  await revokeAllSessions(targetId, 'admin_reset');

  return { temporaryPassword };
}
