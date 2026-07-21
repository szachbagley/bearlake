import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  findRefreshTokenByHash,
  insertRefreshToken,
} from '../../src/db/queries/refreshTokens.js';
import { findUserByEmail, findUserById, insertUser } from '../../src/db/queries/users.js';
import { closePool, getPool } from '../../src/db/pool.js';
import type { NewUser } from '../../src/types/domain.js';
import { rawRow, resetTables } from '../helpers/db.js';

beforeEach(async () => {
  await resetTables();
});

afterAll(async () => {
  await closePool();
});

function newUser(overrides: Partial<NewUser> = {}): NewUser {
  return {
    displayName: 'Rachel Bagley',
    email: 'rachel@example.com',
    passwordHash: '$2b$12$notarealhashjustplaceholdervalue000000000000000000',
    role: 'member',
    mustChangePassword: true,
    isActive: true,
    ...overrides,
  };
}

describe('users queries', () => {
  it('round-trips a user through MySQL', async () => {
    const created = await insertUser(newUser());

    expect(created.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
    expect(created.displayName).toBe('Rachel Bagley');
    expect(created.role).toBe('member');
    expect(created.lastLoginAt).toBeNull();

    const found = await findUserById(created.id);
    expect(found).toEqual(created);
  });

  it('returns booleans, not TINYINT numbers', async () => {
    const created = await insertUser(newUser({ mustChangePassword: false, isActive: true }));

    expect(created.mustChangePassword).toBe(false);
    expect(created.isActive).toBe(true);
  });

  it('returns timestamps as ISO-8601 UTC strings', async () => {
    const created = await insertUser(newUser());

    expect(created.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    // The stored form is a MySQL DATETIME with no offset; the ISO string is
    // produced by the mapper, never by the driver.
    const stored = await rawRow('users', created.id);
    expect(String(stored?.['created_at'])).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/);
  });

  it('writes a timestamp that agrees with the wall clock in UTC', async () => {
    const before = Date.now();
    const created = await insertUser(newUser());
    const after = Date.now();

    // Catches a session or server timezone that is not UTC: a Denver-local
    // connection would land six or seven hours away from now.
    const written = Date.parse(created.createdAt);
    expect(written).toBeGreaterThanOrEqual(before - 1000);
    expect(written).toBeLessThanOrEqual(after + 1000);
  });

  it('finds a user by email regardless of case', async () => {
    const created = await insertUser(newUser({ email: 'rachel@example.com' }));

    expect(await findUserByEmail('rachel@example.com')).toEqual(created);
    expect(await findUserByEmail('Rachel@Example.com')).toEqual(created);
  });

  it('refuses two accounts whose emails differ only in case', async () => {
    await insertUser(newUser({ email: 'zach@example.com' }));

    await expect(insertUser(newUser({ email: 'ZACH@example.com' }))).rejects.toThrow(
      /Duplicate entry/i,
    );
  });

  it('returns null for a user that does not exist', async () => {
    expect(await findUserById(randomUUID())).toBeNull();
    expect(await findUserByEmail('nobody@example.com')).toBeNull();
  });
});

describe('refresh token queries', () => {
  it('round-trips a token and preserves the expiry instant', async () => {
    const user = await insertUser(newUser());
    const expiresAt = '2026-09-15T16:30:00.123Z';

    const created = await insertRefreshToken({
      userId: user.id,
      tokenHash: 'a'.repeat(64),
      expiresAt,
    });

    expect(created.expiresAt).toBe(expiresAt);
    expect(created.revokedAt).toBeNull();
    expect(await findRefreshTokenByHash('a'.repeat(64))).toEqual(created);
  });

  it('accepts an offset-bearing expiry and stores it in UTC', async () => {
    const user = await insertUser(newUser());

    const created = await insertRefreshToken({
      userId: user.id,
      tokenHash: 'b'.repeat(64),
      expiresAt: '2026-09-15T10:30:00.000-06:00',
    });

    expect(created.expiresAt).toBe('2026-09-15T16:30:00.000Z');
  });

  it('rejects a token for a user that does not exist', async () => {
    await expect(
      insertRefreshToken({
        userId: randomUUID(),
        tokenHash: 'c'.repeat(64),
        expiresAt: '2026-09-15T16:30:00.000Z',
      }),
    ).rejects.toThrow(/foreign key/i);
  });

  it('refuses to store the same token hash twice', async () => {
    const user = await insertUser(newUser());
    const hash = 'd'.repeat(64);

    await insertRefreshToken({ userId: user.id, tokenHash: hash, expiresAt: '2026-09-15T16:30:00.000Z' });

    await expect(
      insertRefreshToken({ userId: user.id, tokenHash: hash, expiresAt: '2026-09-15T16:30:00.000Z' }),
    ).rejects.toThrow(/Duplicate entry/i);
  });

  it('returns null for an unknown token hash', async () => {
    expect(await findRefreshTokenByHash('e'.repeat(64))).toBeNull();
  });
});

describe('referential integrity', () => {
  it('refuses to delete a user who has authored rows', async () => {
    const user = await insertUser(newUser());
    await insertRefreshToken({
      userId: user.id,
      tokenHash: 'f'.repeat(64),
      expiresAt: '2026-09-15T16:30:00.000Z',
    });

    // Refresh tokens cascade, but authored content restricts — which is what
    // keeps authorship history intact when an account is retired.
    await getPool().execute(
      `INSERT INTO announcements (id, body, posted_at, created_by, created_at, updated_at)
       VALUES (?, 'Gate code changed', '2026-07-17 16:30:00.000', ?, '2026-07-17 16:30:00.000', '2026-07-17 16:30:00.000')`,
      [randomUUID(), user.id],
    );

    await expect(getPool().execute('DELETE FROM users WHERE id = ?', [user.id])).rejects.toThrow(
      /foreign key/i,
    );
  });
});
