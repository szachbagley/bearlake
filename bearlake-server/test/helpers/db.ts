import type { RowDataPacket } from 'mysql2/promise';
import { getPool } from '../../src/db/pool.js';

/**
 * Per-test database reset.
 *
 * Truncates every table except `_migrations`, so each test starts from a known
 * empty state without paying to re-run migrations. Foreign key checks are
 * disabled for the duration because truncation order would otherwise matter.
 */
export async function resetTables(): Promise<void> {
  const pool = getPool();
  const [tables] = await pool.query<RowDataPacket[]>(
    `SELECT table_name AS name
       FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name <> '_migrations'`,
  );

  const connection = await pool.getConnection();
  try {
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const table of tables) {
      // Identifier comes from information_schema, not from user input.
      await connection.query(`TRUNCATE TABLE \`${String(table['name'])}\``);
    }
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');
  } finally {
    connection.release();
  }
}

/** Reads a raw row, for assertions about what is actually stored on disk. */
export async function rawRow(
  table: string,
  id: string,
): Promise<Record<string, unknown> | undefined> {
  const [rows] = await getPool().execute<RowDataPacket[]>(
    `SELECT * FROM \`${table}\` WHERE id = ?`,
    [id],
  );
  return rows[0];
}
