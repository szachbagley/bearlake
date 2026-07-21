import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { getConfig } from '../config.js';
import {
  findRefreshTokenByHash,
  insertRefreshToken,
  revokeAllRefreshTokensForUser,
  revokeRefreshTokenById,
  rotateRefreshToken,
} from '../db/queries/refreshTokens.js';
import type { RevocationReason } from '../types/domain.js';
import { UnauthenticatedError } from '../types/errors.js';

/**
 * Access and refresh tokens (plan D4, D6, D7).
 *
 * Access tokens are stateless JWTs carrying nothing but a subject. Refresh
 * tokens are opaque random strings; only their SHA-256 hash is stored, so a
 * database dump does not yield usable sessions.
 */

interface AccessTokenPayload {
  sub: string;
}

export function signAccessToken(userId: string): string {
  const config = getConfig();
  return jwt.sign({}, config.jwtSecret, {
    subject: userId,
    algorithm: 'HS256',
    expiresIn: config.accessTokenTtlMinutes * 60,
  });
}

/** Returns the user id, or throws UnauthenticatedError for anything invalid. */
export function verifyAccessToken(token: string): string {
  try {
    // Pinning the algorithm matters: without it, a token signed with "none"
    // or with an asymmetric-key confusion trick would be accepted.
    const payload = jwt.verify(token, getConfig().jwtSecret, {
      algorithms: ['HS256'],
    }) as Partial<AccessTokenPayload>;

    if (typeof payload.sub !== 'string' || payload.sub === '') {
      throw new UnauthenticatedError();
    }
    return payload.sub;
  } catch (err) {
    if (err instanceof UnauthenticatedError) throw err;
    throw new UnauthenticatedError('Your session has expired. Please sign in again.');
  }
}

/**
 * 256 bits of entropy, base64url encoded. Opaque to the client — it carries no
 * claims and means nothing without the matching database row.
 */
function generateRefreshTokenValue(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 is appropriate here: the input is already high-entropy random. */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function refreshExpiry(): string {
  const config = getConfig();
  const expires = new Date(Date.now() + config.refreshTokenTtlDays * 24 * 60 * 60 * 1000);
  return expires.toISOString();
}

/** Issues a brand-new refresh token: login, password change, admin reset. */
export async function issueRefreshToken(userId: string): Promise<string> {
  const token = generateRefreshTokenValue();
  await insertRefreshToken({
    userId,
    tokenHash: hashRefreshToken(token),
    expiresAt: refreshExpiry(),
  });
  return token;
}

export interface RotationResult {
  userId: string;
  refreshToken: string;
}

/**
 * Validates and rotates a presented refresh token (plan D7, refined by D36).
 *
 * Reuse of a token that was revoked *by rotation* is treated as theft: every
 * token for that user is revoked, so the attacker and the legitimate user are
 * both signed out and the family notices something is wrong. Reuse of a token
 * revoked for any other reason is only a dead session.
 */
export async function rotate(presentedToken: string): Promise<RotationResult> {
  const stored = await findRefreshTokenByHash(hashRefreshToken(presentedToken));

  if (stored === null) {
    throw new UnauthenticatedError('Your session has expired. Please sign in again.');
  }

  if (stored.revokedAt !== null) {
    // Only a token revoked by rotation is evidence of theft: its holder should
    // have replaced it and never presented it again. A token revoked by
    // logout, a password change, an admin reset, or deactivation is simply a
    // dead session — the other device waking up and retrying is expected, and
    // punishing it would sign the user out of the session they just created.
    if (stored.revokedReason === 'rotated') {
      await revokeAllRefreshTokensForUser(stored.userId, 'theft');
    }
    throw new UnauthenticatedError('Your session has expired. Please sign in again.');
  }

  if (Date.parse(stored.expiresAt) <= Date.now()) {
    throw new UnauthenticatedError('Your session has expired. Please sign in again.');
  }

  const nextToken = generateRefreshTokenValue();
  const rotated = await rotateRefreshToken(stored.id, {
    userId: stored.userId,
    tokenHash: hashRefreshToken(nextToken),
    expiresAt: refreshExpiry(),
  });

  if (rotated === null) {
    // The row was revoked between the read above and the update — a genuine
    // concurrent replay of the same token. Handled as theft.
    await revokeAllRefreshTokensForUser(stored.userId, 'theft');
    throw new UnauthenticatedError('Your session has expired. Please sign in again.');
  }

  return { userId: stored.userId, refreshToken: nextToken };
}

/** Logout. Idempotent: an unknown or already-revoked token is not an error. */
export async function revokeRefreshToken(presentedToken: string): Promise<void> {
  const stored = await findRefreshTokenByHash(hashRefreshToken(presentedToken));
  if (stored !== null) {
    await revokeRefreshTokenById(stored.id, 'logout');
  }
}

export async function revokeAllSessions(
  userId: string,
  reason: RevocationReason,
): Promise<number> {
  return revokeAllRefreshTokensForUser(userId, reason);
}
