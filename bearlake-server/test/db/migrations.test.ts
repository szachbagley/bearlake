import type { RowDataPacket } from 'mysql2/promise';
import { afterAll, describe, expect, it } from 'vitest';
import { runMigrations, splitStatements } from '../../src/db/migrate.js';
import { closePool, getPool } from '../../src/db/pool.js';

afterAll(async () => {
  await closePool();
});

async function columns(table: string): Promise<Map<string, RowDataPacket>> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT column_name AS name, data_type AS type, is_nullable AS nullable,
            datetime_precision AS precision_, column_type AS full_type
       FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ?`,
    [table],
  );
  return new Map(rows.map((row) => [String(row['name']), row]));
}

describe('migration runner', () => {
  it('has applied the initial migration', async () => {
    const [rows] = await getPool().query<RowDataPacket[]>('SELECT filename FROM _migrations');
    expect(rows.map((row) => String(row['filename']))).toContain('001_init.sql');
  });

  it('is idempotent — a second run applies nothing', async () => {
    const applied = await runMigrations();
    expect(applied).toEqual([]);
  });

  it('created every table in the domain model', async () => {
    const [rows] = await getPool().query<RowDataPacket[]>(
      'SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()',
    );
    const names = rows.map((row) => String(row['name']));

    expect(names.sort()).toEqual([
      '_migrations',
      'announcements',
      'events',
      'info_articles',
      'info_categories',
      'quick_tips',
      'refresh_tokens',
      'users',
    ]);
  });
});

describe('schema shape', () => {
  it('stores every timestamp as DATETIME with millisecond precision', async () => {
    const timestampColumns: Record<string, string[]> = {
      users: ['last_login_at', 'created_at', 'updated_at'],
      refresh_tokens: ['expires_at', 'revoked_at', 'created_at'],
      events: ['starts_at', 'ends_at', 'created_at', 'updated_at'],
      announcements: ['posted_at', 'created_at', 'updated_at'],
      quick_tips: ['created_at', 'updated_at'],
      info_categories: ['created_at', 'updated_at'],
      info_articles: ['created_at', 'updated_at'],
    };

    for (const [table, names] of Object.entries(timestampColumns)) {
      const cols = await columns(table);
      for (const name of names) {
        const column = cols.get(name);
        expect(column, `${table}.${name}`).toBeDefined();
        expect(String(column?.['type']), `${table}.${name} type`).toBe('datetime');
        expect(Number(column?.['precision_']), `${table}.${name} precision`).toBe(3);
      }
    }
  });

  it('never defaults a timestamp in the database', async () => {
    // The application owns every timestamp (plan D33). A DEFAULT or ON UPDATE
    // here would write values the article concurrency check cannot predict.
    const [rows] = await getPool().query<RowDataPacket[]>(
      `SELECT table_name AS tbl, column_name AS col, column_default AS dflt, extra AS extra
         FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND data_type = 'datetime'
          AND table_name <> '_migrations'`,
    );

    for (const row of rows) {
      expect(row['dflt'], `${String(row['tbl'])}.${String(row['col'])} default`).toBeNull();
      expect(String(row['extra']), `${String(row['tbl'])}.${String(row['col'])} extra`).toBe('');
    }
  });

  it('enforces the documented enums', async () => {
    expect(String((await columns('users')).get('role')?.['full_type'])).toBe(
      "enum('admin','member')",
    );
    expect(String((await columns('info_articles')).get('status')?.['full_type'])).toBe(
      "enum('draft','published')",
    );
  });

  it('makes users.email unique', async () => {
    const [rows] = await getPool().query<RowDataPacket[]>(
      `SELECT index_name AS name, non_unique AS non_unique
         FROM information_schema.statistics
        WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'email'`,
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]?.['non_unique'])).toBe(0);
  });

  it('uses a case-insensitive collation on users.email', async () => {
    // This is what makes two accounts differing only in case uncreatable.
    const [rows] = await getPool().query<RowDataPacket[]>(
      `SELECT collation_name AS collation
         FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'email'`,
    );
    expect(String(rows[0]?.['collation'])).toMatch(/_ci$/);
  });

  it('restricts deletion of a category that still holds articles', async () => {
    const [rows] = await getPool().query<RowDataPacket[]>(
      `SELECT delete_rule AS rule
         FROM information_schema.referential_constraints
        WHERE constraint_schema = DATABASE() AND constraint_name = 'fk_info_articles_category'`,
    );
    expect(String(rows[0]?.['rule'])).toBe('RESTRICT');
  });

  it('indexes announcements for keyset pagination', async () => {
    const [rows] = await getPool().query<RowDataPacket[]>(
      `SELECT column_name AS col, seq_in_index AS seq
         FROM information_schema.statistics
        WHERE table_schema = DATABASE() AND table_name = 'announcements'
          AND index_name = 'ix_announcements_posted_at_id'
        ORDER BY seq_in_index`,
    );
    expect(rows.map((row) => String(row['col']))).toEqual(['posted_at', 'id']);
  });

  it('stores article blocks as JSON', async () => {
    expect(String((await columns('info_articles')).get('blocks')?.['type'])).toBe('json');
  });
});

describe('statement splitter', () => {
  it('splits on statement boundaries and drops comments', () => {
    const sql = `
      -- a leading comment;
      CREATE TABLE a (id INT);
      /* block ; comment */
      CREATE TABLE b (id INT);
    `;
    expect(splitStatements(sql)).toEqual(['CREATE TABLE a (id INT)', 'CREATE TABLE b (id INT)']);
  });

  it('does not split on a semicolon inside a quoted string', () => {
    const sql = "INSERT INTO t (v) VALUES ('a;b'); INSERT INTO t (v) VALUES (\"c;d\");";
    expect(splitStatements(sql)).toEqual([
      "INSERT INTO t (v) VALUES ('a;b')",
      'INSERT INTO t (v) VALUES ("c;d")',
    ]);
  });

  it('does not split on a semicolon inside a backtick identifier', () => {
    expect(splitStatements('SELECT `we;ird` FROM t;')).toEqual(['SELECT `we;ird` FROM t']);
  });

  it('ignores a trailing semicolon and blank input', () => {
    expect(splitStatements('SELECT 1;')).toEqual(['SELECT 1']);
    expect(splitStatements('   \n -- nothing \n ')).toEqual([]);
  });
});
