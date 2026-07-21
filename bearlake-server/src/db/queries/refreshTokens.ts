import { randomUUID } from 'node:crypto';
import type { RowDataPacket } from 'mysql2/promise';
import type { NewRefreshToken, RefreshToken } from '../../types/domain.js';
import { dbNow, toApiTimestamp, toDbTimestamp } from '../mapper.js';
import { getPool } from '../pool.js';

/**
 * All SQL touching `refresh_tokens` lives here.
 *
 * Rotation, reuse detection, and bulk revocation arrive in Phase 2; this file
 * currently covers insert and lookup only.
 */

const COLUMNS = 'id, user_id, token_hash, expires_at, revoked_at, created_at';

function toRefreshToken(row: RowDataPacket): RefreshToken {
  return {
    id: String(row['id']),
    userId: String(row['user_id']),
    tokenHash: String(row['token_hash']),
    expiresAt: toApiTimestamp(String(row['expires_at'])),
    revokedAt: row['revoked_at'] === null ? null : toApiTimestamp(String(row['revoked_at'])),
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
