import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import { getConfig } from '../config.js';
import { loadEnv } from '../lib/loadEnv.js';
import { logger } from '../lib/logger.js';
import { buildPoolOptions } from './pool.js';

/**
 * Migration runner (plan D28).
 *
 * Ordered `NNN_name.sql` files, applied once each, recorded by filename in
 * `_migrations`. Forward-only: there are no down migrations. MySQL DDL
 * auto-commits, so a file that fails partway leaves its earlier statements
 * applied — recover by writing a new migration, never by editing an applied
 * one.
 *
 * Runs on boot before the server listens, and standalone via `npm run migrate`.
 */

const MIGRATIONS_DIR = new URL('./migrations/', import.meta.url);
const LOCK_NAME = 'bearlake_migrations';
const LOCK_TIMEOUT_SECONDS = 30;

/**
 * Splits a migration file into individual statements.
 *
 * mysql2's `multipleStatements` would accept the whole file at once, but then
 * a failure reports only the server's message with no indication of which
 * statement produced it. Quote and comment handling here is deliberately
 * minimal — migrations are checked-in DDL, not arbitrary SQL.
 */
export function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let quote: string | undefined;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i] ?? '';
    const next = sql[i + 1] ?? '';

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false;
        current += char;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }

    if (quote === undefined) {
      if (char === '-' && next === '-') {
        inLineComment = true;
        i += 1;
        continue;
      }
      if (char === '/' && next === '*') {
        inBlockComment = true;
        i += 1;
        continue;
      }
      if (char === "'" || char === '"' || char === '`') {
        quote = char;
      } else if (char === ';') {
        statements.push(current);
        current = '';
        continue;
      }
    } else if (char === '\\') {
      // Escaped character inside a quoted string: consume both.
      current += char + next;
      i += 1;
      continue;
    } else if (char === quote) {
      quote = undefined;
    }

    current += char;
  }

  statements.push(current);

  return statements.map((statement) => statement.trim()).filter((statement) => statement !== '');
}

async function listMigrationFiles(): Promise<string[]> {
  const entries = await readdir(MIGRATIONS_DIR);
  return entries.filter((name) => name.endsWith('.sql')).sort((a, b) => a.localeCompare(b));
}

async function appliedFilenames(connection: Connection): Promise<Set<string>> {
  const [rows] = await connection.query<RowDataPacket[]>('SELECT filename FROM _migrations');
  return new Set(rows.map((row) => String(row['filename'])));
}

/**
 * Applies every pending migration. Returns the filenames applied by this call,
 * which is empty when the database is already up to date.
 */
export async function runMigrations(): Promise<string[]> {
  const options = buildPoolOptions(getConfig());
  const connection = await mysql.createConnection({
    ...options,
    multipleStatements: false,
  });

  const applied: string[] = [];

  try {
    await connection.query("SET time_zone = '+00:00'");

    // Guards against two instances booting simultaneously and racing to apply
    // the same file. Railway runs one instance today; this keeps that from
    // being a silent assumption.
    const [lockRows] = await connection.query<RowDataPacket[]>('SELECT GET_LOCK(?, ?) AS acquired', [
      LOCK_NAME,
      LOCK_TIMEOUT_SECONDS,
    ]);
    if (Number(lockRows[0]?.['acquired']) !== 1) {
      throw new Error('Could not acquire the migration lock; another process may be migrating.');
    }

    try {
      await connection.query(
        `CREATE TABLE IF NOT EXISTS _migrations (
           filename   VARCHAR(255) NOT NULL,
           applied_at DATETIME(3)  NOT NULL,
           PRIMARY KEY (filename)
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      );

      const files = await listMigrationFiles();
      const done = await appliedFilenames(connection);

      for (const filename of files) {
        if (done.has(filename)) continue;

        const sql = await readFile(new URL(filename, MIGRATIONS_DIR), 'utf8');
        const statements = splitStatements(sql);

        for (const [index, statement] of statements.entries()) {
          try {
            await connection.query(statement);
          } catch (err) {
            throw new Error(
              `Migration ${filename} failed at statement ${String(index + 1)} of ${String(statements.length)}`,
              { cause: err },
            );
          }
        }

        await connection.query('INSERT INTO _migrations (filename, applied_at) VALUES (?, UTC_TIMESTAMP(3))', [
          filename,
        ]);

        applied.push(filename);
        logger.info('migration_applied', { filename, statements: statements.length });
      }
    } finally {
      await connection.query('SELECT RELEASE_LOCK(?)', [LOCK_NAME]);
    }
  } finally {
    await connection.end();
  }

  if (applied.length === 0) {
    logger.info('migrations_up_to_date');
  }

  return applied;
}

// `npm run migrate`
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  loadEnv();
  runMigrations()
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      logger.error('migration_failed', err);
      process.exit(1);
    });
}

export const migrationsDirectory = fileURLToPath(MIGRATIONS_DIR);
