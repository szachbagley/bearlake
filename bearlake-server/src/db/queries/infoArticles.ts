import { randomUUID } from 'node:crypto';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { ArticleStatus, ArticleSummary, ArticleWrite, Block, InfoArticle } from '../../types/domain.js';
import { dbNow, toApiTimestamp, toDbTimestamp } from '../mapper.js';
import { getPool } from '../pool.js';

/**
 * All SQL touching `info_articles` lives here.
 *
 * `schema_version` is stamped by the application on every write (plan D21); the
 * constant lives here because this module owns what goes into the row.
 */

export const CURRENT_BLOCK_SCHEMA_VERSION = 1;

const SUMMARY_COLUMNS = 'id, category_id, title, status, sort_order, updated_at';
const FULL_COLUMNS = `id, category_id, title, blocks, schema_version, status,
                      sort_order, created_by, created_at, updated_at`;

function toStatus(value: unknown): ArticleStatus {
  if (value === 'draft' || value === 'published') return value;
  throw new Error(`Unrecognized article status in the database: ${JSON.stringify(value)}`);
}

/**
 * mysql2 returns a JSON column already parsed, but a defensive parse keeps this
 * correct if that ever changes. The stored value is our own validated data.
 */
function parseBlocks(value: unknown): Block[] {
  const parsed = typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
  return parsed as Block[];
}

function toSummary(row: RowDataPacket): ArticleSummary {
  return {
    id: String(row['id']),
    categoryId: String(row['category_id']),
    title: String(row['title']),
    status: toStatus(row['status']),
    sortOrder: Number(row['sort_order']),
    updatedAt: toApiTimestamp(String(row['updated_at'])),
  };
}

function toArticle(row: RowDataPacket): InfoArticle {
  return {
    id: String(row['id']),
    categoryId: String(row['category_id']),
    title: String(row['title']),
    blocks: parseBlocks(row['blocks']),
    schemaVersion: Number(row['schema_version']),
    status: toStatus(row['status']),
    sortOrder: Number(row['sort_order']),
    createdBy: String(row['created_by']),
    createdAt: toApiTimestamp(String(row['created_at'])),
    updatedAt: toApiTimestamp(String(row['updated_at'])),
  };
}

/**
 * Article summaries in a category. `includeDrafts` is derived from the caller's
 * role and applied in SQL, never as a client-side filter — drafts must never
 * reach a member (spec §4.4).
 */
export async function listArticlesByCategory(
  categoryId: string,
  includeDrafts: boolean,
): Promise<ArticleSummary[]> {
  const statusClause = includeDrafts ? '' : "AND status = 'published'";
  const [rows] = await getPool().execute<RowDataPacket[]>(
    `SELECT ${SUMMARY_COLUMNS} FROM info_articles
      WHERE category_id = ? ${statusClause}
      ORDER BY sort_order ASC, created_at ASC, id ASC`,
    [categoryId],
  );
  return rows.map(toSummary);
}

export async function findArticleById(id: string): Promise<InfoArticle | null> {
  const [rows] = await getPool().execute<RowDataPacket[]>(
    `SELECT ${FULL_COLUMNS} FROM info_articles WHERE id = ?`,
    [id],
  );
  const row = rows[0];
  return row === undefined ? null : toArticle(row);
}

export async function nextArticleSortOrder(categoryId: string): Promise<number> {
  const [rows] = await getPool().execute<RowDataPacket[]>(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM info_articles WHERE category_id = ?',
    [categoryId],
  );
  return Number(rows[0]?.['next'] ?? 0);
}

export async function insertArticle(input: ArticleWrite, createdBy: string): Promise<InfoArticle> {
  const id = randomUUID();
  const now = dbNow();
  await getPool().execute(
    `INSERT INTO info_articles
       (id, category_id, title, blocks, schema_version, status, sort_order,
        created_by, created_at, updated_at)
     VALUES (?, ?, ?, CAST(? AS JSON), ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.categoryId,
      input.title,
      JSON.stringify(input.blocks),
      CURRENT_BLOCK_SCHEMA_VERSION,
      input.status,
      input.sortOrder,
      createdBy,
      now,
      now,
    ],
  );
  const created = await findArticleById(id);
  if (created === null) {
    throw new Error('Article disappeared immediately after insert.');
  }
  return created;
}

/**
 * Optimistic-locking update (plan D23).
 *
 * The `updated_at = ?` guard in the WHERE clause is what makes the check
 * atomic: even if two patches read the same version and both pass a service-
 * level comparison, only the first UPDATE matches the row, and the second sees
 * zero affected rows. The caller maps that to a 409.
 */
export interface ConcurrentUpdateResult {
  outcome: 'updated' | 'stale';
  article: InfoArticle | null;
}

export async function updateArticleIfCurrent(
  id: string,
  expectedUpdatedAt: string,
  input: ArticleWrite,
): Promise<ConcurrentUpdateResult> {
  const [result] = await getPool().execute<ResultSetHeader>(
    `UPDATE info_articles
        SET category_id = ?, title = ?, blocks = CAST(? AS JSON), schema_version = ?,
            status = ?, sort_order = ?, updated_at = ?
      WHERE id = ? AND updated_at = ?`,
    [
      input.categoryId,
      input.title,
      JSON.stringify(input.blocks),
      CURRENT_BLOCK_SCHEMA_VERSION,
      input.status,
      input.sortOrder,
      dbNow(),
      id,
      toDbTimestamp(expectedUpdatedAt),
    ],
  );

  if (result.affectedRows === 0) {
    return { outcome: 'stale', article: null };
  }
  return { outcome: 'updated', article: await findArticleById(id) };
}

export async function deleteArticle(id: string): Promise<boolean> {
  const [result] = await getPool().execute<ResultSetHeader>(
    'DELETE FROM info_articles WHERE id = ?',
    [id],
  );
  return result.affectedRows > 0;
}
