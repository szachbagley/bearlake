import {
  findUserByEmail,
  findUserById,
  updateLastLoginAt,
  updatePassword,
} from '../db/queries/users.js';
import { InvalidCredentialsError, UnauthenticatedError, ValidationError } from '../types/errors.js';
import {
  assertPasswordAllowed,
  hashPassword,
  verifyDummyPassword,
  verifyPassword,
} from './passwordService.js';
import {
  issueRefreshToken,
  revokeAllSessions,
  revokeRefreshToken,
  rotate,
  signAccessToken,
} from './tokenService.js';
import { type PublicUser, toPublicUser } from './userSerializer.js';

export interface SessionResult {
  accessToken: string;
  refreshToken: string;
  user: PublicUser;
}

/**
 * Signs a user in.
 *
 * Every failure path — unknown email, wrong password, deactivated account —
 * produces the identical InvalidCredentialsError, and the unknown-email path
 * burns a bcrypt comparison first so the three are indistinguishable by
 * timing as well as by response (plan D12).
 *
 * A user with mustChangePassword still receives tokens: they need them to call
 * the change-password endpoint. The gate middleware blocks everything else.
 */
export async function login(email: string, password: string): Promise<SessionResult> {
  const user = await findUserByEmail(email);

  if (user === null) {
    await verifyDummyPassword(password);
    throw new InvalidCredentialsError();
  }

  const passwordMatches = await verifyPassword(password, user.passwordHash);

  if (!passwordMatches || !user.isActive) {
    throw new InvalidCredentialsError();
  }

  await updateLastLoginAt(user.id);

  const refreshed = await findUserById(user.id);

  return {
    accessToken: signAccessToken(user.id),
    refreshToken: await issueRefreshToken(user.id),
    user: toPublicUser(refreshed ?? user),
  };
}

/**
 * Exchanges a refresh token for a new pair, rotating the presented one.
 *
 * A token belonging to a user who has since been deactivated is rejected and
 * that user's whole token family revoked, so `isActive = false` ends existing
 * sessions rather than merely preventing new logins.
 */
export async function refresh(presentedToken: string): Promise<SessionResult> {
  const { userId, refreshToken } = await rotate(presentedToken);

  const user = await findUserById(userId);

  if (user === null || !user.isActive) {
    await revokeAllSessions(userId, 'deactivated');
    throw new UnauthenticatedError('Your session has expired. Please sign in again.');
  }

  return {
    accessToken: signAccessToken(user.id),
    refreshToken,
    user: toPublicUser(user),
  };
}

export async function logout(presentedToken: string): Promise<void> {
  await revokeRefreshToken(presentedToken);
}

/**
 * Changes the caller's own password (plan D9).
 *
 * The current password is required even during the forced first-login change:
 * the client still holds the temporary password it just signed in with, and
 * requiring it means a stolen access token alone cannot take over an account.
 *
 * On success every existing session is revoked — including this caller's — and
 * a fresh pair is issued, so a password change signs out other devices.
 */
export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<SessionResult> {
  const user = await findUserById(userId);

  if (user === null) {
    throw new UnauthenticatedError();
  }

  const currentMatches = await verifyPassword(currentPassword, user.passwordHash);
  if (!currentMatches) {
    throw new InvalidCredentialsError('Your current password is not correct.');
  }

  if (newPassword === currentPassword) {
    throw new ValidationError('Your new password must be different from your current one.');
  }

  assertPasswordAllowed(newPassword);

  await updatePassword(user.id, await hashPassword(newPassword));
  await revokeAllSessions(user.id, 'password_change');

  const updated = await findUserById(user.id);
  if (updated === null) {
    throw new UnauthenticatedError();
  }

  return {
    accessToken: signAccessToken(updated.id),
    refreshToken: await issueRefreshToken(updated.id),
    user: toPublicUser(updated),
  };
}
