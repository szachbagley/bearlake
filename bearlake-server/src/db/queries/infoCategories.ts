import { randomUUID } from 'node:crypto';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { InfoCategory } from '../../types/domain.js';
import { dbNow, toApiTimestamp } from '../mapper.js';
import { getPool } from '../pool.js';

/** All SQL touching `info_categories` lives here. Every statement is parameterized. */

const COLUMNS = 'id, title, sort_order, created_at, updated_at';

function toCategory(row: RowDataPacket): InfoCategory {
  return {
    id: String(row['id']),
    title: String(row['title']),
    sortOrder: Number(row['sort_order']),
    createdAt: toApiTimestamp(String(row['created_at'])),
    updatedAt: toApiTimestamp(String(row['updated_at'])),
  };
}

export async function listCategories(): Promise<InfoCategory[]> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM info_categories ORDER BY sort_order ASC, created_at ASC, id ASC`,
  );
  return rows.map(toCategory);
}

export async function findCategoryById(id: string): Promise<InfoCategory | null> {
  const [rows] = await getPool().execute<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM info_categories WHERE id = ?`,
    [id],
  );
  const row = rows[0];
  return row === undefined ? null : toCategory(row);
}

export async function nextCategorySortOrder(): Promise<number> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM info_categories',
  );
  return Number(rows[0]?.['next'] ?? 0);
}

export async function insertCategory(title: string, sortOrder: number): Promise<InfoCategory> {
  const id = randomUUID();
  const now = dbNow();
  await getPool().execute(
    `INSERT INTO info_categories (id, title, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    [id, title, sortOrder, now, now],
  );
  const created = await findCategoryById(id);
  if (created === null) {
    throw new Error('Category disappeared immediately after insert.');
  }
  return created;
}

export interface CategoryUpdate {
  title?: string | undefined;
  sortOrder?: number | undefined;
}

export async function updateCategory(
  id: string,
  update: CategoryUpdate,
): Promise<InfoCategory | null> {
  const assignments: string[] = [];
  const params: (string | number)[] = [];

  if (update.title !== undefined) {
    assignments.push('title = ?');
    params.push(update.title);
  }
  if (update.sortOrder !== undefined) {
    assignments.push('sort_order = ?');
    params.push(update.sortOrder);
  }

  if (assignments.length === 0) {
    return findCategoryById(id);
  }

  assignments.push('updated_at = ?');
  params.push(dbNow(), id);

  await getPool().execute(`UPDATE info_categories SET ${assignments.join(', ')} WHERE id = ?`, params);
  return findCategoryById(id);
}

/** Count of articles in a category, for the delete guard (plan D2). */
export async function countArticlesInCategory(categoryId: string): Promise<number> {
  const [rows] = await getPool().execute<RowDataPacket[]>(
    'SELECT COUNT(*) AS count FROM info_articles WHERE category_id = ?',
    [categoryId],
  );
  return Number(rows[0]?.['count'] ?? 0);
}

export async function deleteCategory(id: string): Promise<boolean> {
  const [result] = await getPool().execute<ResultSetHeader>(
    'DELETE FROM info_categories WHERE id = ?',
    [id],
  );
  return result.affectedRows > 0;
}
