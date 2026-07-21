import { randomUUID } from 'node:crypto';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { NewRefreshToken, RefreshToken, RevocationReason } from '../../types/domain.js';
import { dbNow, toApiTimestamp, toDbTimestamp } from '../mapper.js';
import { getPool } from '../pool.js';

/** All SQL touching `refresh_tokens` lives here. */

const COLUMNS =
  'id, user_id, token_hash, expires_at, revoked_at, revoked_reason, created_at';

const REVOCATION_REASONS: readonly RevocationReason[] = [
  'rotated',
  'logout',
  'password_change',
  'admin_reset',
  'deactivated',
  'theft',
];

function toRevocationReason(value: unknown): RevocationReason | null {
  if (value === null || value === undefined) return null;
  const found = REVOCATION_REASONS.find((reason) => reason === value);
  if (found === undefined) {
    throw new Error(`Unrecognized revocation reason in the database: ${JSON.stringify(value)}`);
  }
  return found;
}

function toRefreshToken(row: RowDataPacket): RefreshToken {
  return {
    id: String(row['id']),
    userId: String(row['user_id']),
    tokenHash: String(row['token_hash']),
    expiresAt: toApiTimestamp(String(row['expires_at'])),
    revokedAt: row['revoked_at'] === null ? null : toApiTimestamp(String(row['revoked_at'])),
    revokedReason: toRevocationReason(row['revoked_reason']),
    createdAt: toApiTimestamp(String(row['created_at'])),
  };
}

export async function insertRefreshToken(input: NewRefreshToken): Promise<RefreshToken> {
  const id = randomUUID();

  await getPool().execute(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, revoked_at, created_at)
     VALUES (?, ?, ?, ?, NULL, ?)`,
    [id, input.userId, input.tokenHash, toDbTimestamp(input.expiresAt), dbNow()],
  );

  const created = await findRefreshTokenById(id);
  if (created === null) {
    throw new Error('Refresh token disappeared immediately after insert.');
  }
  return created;
}

export async function findRefreshTokenById(id: string): Promise<RefreshToken | null> {
  const [rows] = await getPool().execute<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM refresh_tokens WHERE id = ?`,
    [id],
  );
  const row = rows[0];
  return row === undefined ? null : toRefreshToken(row);
}

export async function findRefreshTokenByHash(tokenHash: string): Promise<RefreshToken | null> {
  const [rows] = await getPool().execute<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM refresh_tokens WHERE token_hash = ?`,
    [tokenHash],
  );
  const row = rows[0];
  return row === undefined ? null : toRefreshToken(row);
}

/**
 * Revokes one token. Returns false when it was already revoked, which is how
 * the caller distinguishes a first use from a replay.
 */
export async function revokeRefreshTokenById(
  id: string,
  reason: RevocationReason,
): Promise<boolean> {
  const [result] = await getPool().execute<ResultSetHeader>(
    `UPDATE refresh_tokens
        SET revoked_at = ?, revoked_reason = ?
      WHERE id = ? AND revoked_at IS NULL`,
    [dbNow(), reason, id],
  );
  return result.affectedRows > 0;
}

/** Revokes every live token for a user: password change, reset, deactivation, theft. */
export async function revokeAllRefreshTokensForUser(
  userId: string,
  reason: RevocationReason,
): Promise<number> {
  const [result] = await getPool().execute<ResultSetHeader>(
    `UPDATE refresh_tokens
        SET revoked_at = ?, revoked_reason = ?
      WHERE user_id = ? AND revoked_at IS NULL`,
    [dbNow(), reason, userId],
  );
  return result.affectedRows;
}

/**
 * Atomically revokes the presented token and issues its replacement.
 *
 * Returns null when the old token was already revoked, which happens either
 * because it is being replayed or because two refreshes raced. Both cases are
 * treated as theft by the caller — the conservative reading, and the one the
 * spec asks for.
 */
export async function rotateRefreshToken(
  oldTokenId: string,
  next: NewRefreshToken,
): Promise<RefreshToken | null> {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();

    const [revoked] = await connection.execute<ResultSetHeader>(
      `UPDATE refresh_tokens
          SET revoked_at = ?, revoked_reason = 'rotated'
        WHERE id = ? AND revoked_at IS NULL`,
      [dbNow(), oldTokenId],
    );

    if (revoked.affectedRows === 0) {
      await connection.rollback();
      return null;
    }

    const id = randomUUID();
    await connection.execute(
      `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, revoked_at, created_at)
       VALUES (?, ?, ?, ?, NULL, ?)`,
      [id, next.userId, next.tokenHash, toDbTimestamp(next.expiresAt), dbNow()],
    );

    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT ${COLUMNS} FROM refresh_tokens WHERE id = ?`,
      [id],
    );

    await connection.commit();

    const row = rows[0];
    if (row === undefined) {
      throw new Error('Rotated refresh token disappeared immediately after insert.');
    }
    return toRefreshToken(row);
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}
