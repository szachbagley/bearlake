import type { RowDataPacket } from 'mysql2/promise';
import { runMigrations } from '../db/migrate.js';
import { closePool, getPool } from '../db/pool.js';
import { insertUser } from '../db/queries/users.js';
import { loadEnv } from '../lib/loadEnv.js';
import { logger } from '../lib/logger.js';
import { generateTemporaryPassword, hashPassword } from '../services/passwordService.js';

/**
 * First-admin bootstrap (plan D1).
 *
 *   npm run seed:admin -- <email> "<display name>"
 *
 * Prints a temporary password once, to the operator's terminal. It is never
 * logged and never recoverable — rerun with a reset if it is lost.
 *
 * Refuses to run if any admin already exists, so it cannot be used to quietly
 * add a second privileged account. Subsequent admins are created through
 * `POST /users` by an existing admin, like every other account.
 */

async function adminExists(): Promise<boolean> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    "SELECT COUNT(*) AS count FROM users WHERE role = 'admin'",
  );
  return Number(rows[0]?.['count'] ?? 0) > 0;
}

async function main(): Promise<void> {
  const [email, displayName] = process.argv.slice(2);

  if (email === undefined || displayName === undefined) {
    throw new Error('Usage: npm run seed:admin -- <email> "<display name>"');
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizedEmail)) {
    throw new Error(`Not a valid email address: ${email}`);
  }

  await runMigrations();

  if (await adminExists()) {
    throw new Error(
      'An admin account already exists. Create further accounts from the web app.',
    );
  }

  const temporaryPassword = generateTemporaryPassword();

  const user = await insertUser({
    displayName: displayName.trim(),
    email: normalizedEmail,
    passwordHash: await hashPassword(temporaryPassword),
    role: 'admin',
    mustChangePassword: true,
    isActive: true,
  });

  // Written to stdout directly, not through the logger: the logger's output is
  // a log stream that may be shipped and retained, and this value must not be.
  process.stdout.write(
    [
      '',
      'Admin account created.',
      '',
      `  Email:              ${user.email}`,
      `  Temporary password: ${temporaryPassword}`,
      '',
      '  This password is shown once and cannot be retrieved again.',
      '  It must be changed on first sign-in.',
      '',
    ].join('\n'),
  );
}

loadEnv();

main()
  .then(async () => {
    await closePool();
    process.exit(0);
  })
  .catch(async (err: unknown) => {
    logger.error('seed_admin_failed', err);
    await closePool();
    process.exit(1);
  });
