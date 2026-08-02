import { randomUUID } from 'node:crypto';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { QuickTip } from '../../types/domain.js';
import { dbNow, toApiTimestamp } from '../mapper.js';
import { getPool } from '../pool.js';

/** All SQL touching `quick_tips` lives here. Every statement is parameterized. */

const COLUMNS = 'id, body, sort_order, created_by, created_at, updated_at';

function toQuickTip(row: RowDataPacket): QuickTip {
  return {
    id: String(row['id']),
    body: String(row['body']),
    sortOrder: Number(row['sort_order']),
    createdBy: String(row['created_by']),
    createdAt: toApiTimestamp(String(row['created_at'])),
    updatedAt: toApiTimestamp(String(row['updated_at'])),
  };
}

/** All tips, in display order: admin-set `sortOrder`, then creation order. */
export async function listQuickTips(): Promise<QuickTip[]> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM quick_tips ORDER BY sort_order ASC, created_at ASC, id ASC`,
  );
  return rows.map(toQuickTip);
}

export async function findQuickTipById(id: string): Promise<QuickTip | null> {
  const [rows] = await getPool().execute<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM quick_tips WHERE id = ?`,
    [id],
  );
  const row = rows[0];
  return row === undefined ? null : toQuickTip(row);
}

/** The next default sort order: one past the current maximum (plan D19). */
export async function nextQuickTipSortOrder(): Promise<number> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM quick_tips',
  );
  return Number(rows[0]?.['next'] ?? 0);
}

export async function insertQuickTip(
  body: string,
  sortOrder: number,
  createdBy: string,
): Promise<QuickTip> {
  const id = randomUUID();
  const now = dbNow();
  await getPool().execute(
    `INSERT INTO quick_tips (id, body, sort_order, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, body, sortOrder, createdBy, now, now],
  );
  const created = await findQuickTipById(id);
  if (created === null) {
    throw new Error('Quick tip disappeared immediately after insert.');
  }
  return created;
}

export interface QuickTipUpdate {
  body?: string | undefined;
  sortOrder?: number | undefined;
}

export async function updateQuickTip(
  id: string,
  update: QuickTipUpdate,
): Promise<QuickTip | null> {
  const assignments: string[] = [];
  const params: (string | number)[] = [];

  if (update.body !== undefined) {
    assignments.push('body = ?');
    params.push(update.body);
  }
  if (update.sortOrder !== undefined) {
    assignments.push('sort_order = ?');
    params.push(update.sortOrder);
  }

  if (assignments.length === 0) {
    return findQuickTipById(id);
  }

  assignments.push('updated_at = ?');
  params.push(dbNow(), id);

  await getPool().execute(`UPDATE quick_tips SET ${assignments.join(', ')} WHERE id = ?`, params);
  return findQuickTipById(id);
}

export async function deleteQuickTip(id: string): Promise<boolean> {
  const [result] = await getPool().execute<ResultSetHeader>(
    'DELETE FROM quick_tips WHERE id = ?',
    [id],
  );
  return result.affectedRows > 0;
}
