import { randomUUID } from 'node:crypto';
import type { RowDataPacket } from 'mysql2/promise';
import type { NewUser, User, UserRole } from '../../types/domain.js';
import { dbNow, toApiTimestamp, toBoolean, toDbBoolean } from '../mapper.js';
import { getPool } from '../pool.js';

/**
 * All SQL touching `users` lives here. Every statement is parameterized;
 * nothing in this file interpolates a value into a query string.
 */

const COLUMNS = `id, display_name, email, password_hash, role,
                 must_change_password, is_active, last_login_at,
                 created_at, updated_at`;

function toUserRole(value: unknown): UserRole {
  if (value === 'admin' || value === 'member') return value;
  throw new Error(`Unrecognized user role in the database: ${JSON.stringify(value)}`);
}

function toUser(row: RowDataPacket): User {
  return {
    id: String(row['id']),
    displayName: String(row['display_name']),
    email: String(row['email']),
    passwordHash: String(row['password_hash']),
    role: toUserRole(row['role']),
    mustChangePassword: toBoolean(row['must_change_password']),
    isActive: toBoolean(row['is_active']),
    lastLoginAt: row['last_login_at'] === null ? null : toApiTimestamp(String(row['last_login_at'])),
    createdAt: toApiTimestamp(String(row['created_at'])),
    updatedAt: toApiTimestamp(String(row['updated_at'])),
  };
}

export async function insertUser(input: NewUser): Promise<User> {
  const id = randomUUID();
  const now = dbNow();

  await getPool().execute(
    `INSERT INTO users
       (id, display_name, email, password_hash, role,
        must_change_password, is_active, last_login_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    [
      id,
      input.displayName,
      input.email,
      input.passwordHash,
      input.role,
      toDbBoolean(input.mustChangePassword),
      toDbBoolean(input.isActive),
      now,
      now,
    ],
  );

  const created = await findUserById(id);
  if (created === null) {
    throw new Error('User disappeared immediately after insert.');
  }
  return created;
}

export async function findUserById(id: string): Promise<User | null> {
  const [rows] = await getPool().execute<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM users WHERE id = ?`,
    [id],
  );
  const row = rows[0];
  return row === undefined ? null : toUser(row);
}

/** Every account, active and deactivated, ordered for display. */
export async function listUsers(): Promise<User[]> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM users ORDER BY display_name ASC, created_at ASC`,
  );
  return rows.map(toUser);
}

/**
 * `| undefined` is explicit because exactOptionalPropertyTypes distinguishes
 * "absent" from "present and undefined", and callers build this from optional
 * schema fields.
 */
export interface UserUpdate {
  displayName?: string | undefined;
  role?: UserRole | undefined;
  isActive?: boolean | undefined;
}

/**
 * Updates the admin-editable fields.
 *
 * Email and password are deliberately absent: email is the login identifier
 * and changing it silently would strand the account, and passwords move only
 * through the change-password and reset flows. Column names below are literals
 * chosen by this function, never values from the request.
 */
export async function updateUser(id: string, update: UserUpdate): Promise<User | null> {
  const assignments: string[] = [];
  const params: (string | number)[] = [];

  if (update.displayName !== undefined) {
    assignments.push('display_name = ?');
    params.push(update.displayName);
  }
  if (update.role !== undefined) {
    assignments.push('role = ?');
    params.push(update.role);
  }
  if (update.isActive !== undefined) {
    assignments.push('is_active = ?');
    params.push(toDbBoolean(update.isActive));
  }

  if (assignments.length === 0) {
    return findUserById(id);
  }

  assignments.push('updated_at = ?');
  params.push(dbNow(), id);

  await getPool().execute(`UPDATE users SET ${assignments.join(', ')} WHERE id = ?`, params);

  return findUserById(id);
}

/**
 * Sets a new password hash and *forces* a change on next sign-in.
 *
 * The mirror image of updatePassword, which clears the flag. Kept as two
 * functions rather than one with a boolean, because the caller reading
 * `resetUserPassword` should not have to remember which way the flag goes.
 */
export async function resetUserPassword(id: string, passwordHash: string): Promise<void> {
  await getPool().execute(
    `UPDATE users
        SET password_hash = ?, must_change_password = 1, updated_at = ?
      WHERE id = ?`,
    [passwordHash, dbNow(), id],
  );
}

export async function updateLastLoginAt(id: string, at: string = dbNow()): Promise<void> {
  await getPool().execute('UPDATE users SET last_login_at = ? WHERE id = ?', [at, id]);
}

/**
 * Sets a new password hash and clears the forced-change flag.
 *
 * Revoking the user's refresh tokens is the caller's job — it belongs to the
 * same logical operation but to a different table, and the auth service
 * sequences both.
 */
export async function updatePassword(id: string, passwordHash: string): Promise<void> {
  const now = dbNow();
  await getPool().execute(
    `UPDATE users
        SET password_hash = ?, must_change_password = 0, updated_at = ?
      WHERE id = ?`,
    [passwordHash, now, id],
  );
}

/**
 * Email lookup. The caller normalizes to lowercase; the column's
 * utf8mb4_0900_ai_ci collation makes the comparison case-insensitive
 * regardless, which is also what makes the unique index reject two accounts
 * differing only in case.
 */
export async function findUserByEmail(email: string): Promise<User | null> {
  const [rows] = await getPool().execute<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM users WHERE email = ?`,
    [email],
  );
  const row = rows[0];
  return row === undefined ? null : toUser(row);
}
