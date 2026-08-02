import { randomUUID } from 'node:crypto';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { Announcement } from '../../types/domain.js';
import { dbNow, toApiTimestamp, toDbTimestamp } from '../mapper.js';
import { getPool } from '../pool.js';

/** All SQL touching `announcements` lives here. Every statement is parameterized. */

const COLUMNS = 'id, body, posted_at, created_by, created_at, updated_at';

function toAnnouncement(row: RowDataPacket): Announcement {
  return {
    id: String(row['id']),
    body: String(row['body']),
    postedAt: toApiTimestamp(String(row['posted_at'])),
    createdBy: String(row['created_by']),
    createdAt: toApiTimestamp(String(row['created_at'])),
    updatedAt: toApiTimestamp(String(row['updated_at'])),
  };
}

/** The keyset position a page continues from (plan D18). */
export interface AnnouncementCursor {
  postedAt: string;
  id: string;
}

/**
 * A page of announcements, newest first, in `(posted_at DESC, id DESC)` order.
 *
 * `fetchLimit` should be the page size plus one: the caller uses the presence
 * of the extra row to decide whether a next cursor exists, without a second
 * count query. The id tiebreaker makes the order total, so announcements
 * sharing a `posted_at` cannot be skipped or repeated across pages.
 *
 * These use `query`, not `execute`: mysql2's prepared-statement path sends a
 * `LIMIT ?` value as a string, which MySQL rejects ("Incorrect arguments to
 * mysqld_stmt_execute"). `query` escapes parameters the same way, so values
 * are still passed separately and never concatenated into the SQL.
 */
export async function listAnnouncements(
  fetchLimit: number,
  cursor: AnnouncementCursor | null,
): Promise<Announcement[]> {
  const order = 'ORDER BY posted_at DESC, id DESC LIMIT ?';

  if (cursor === null) {
    const [rows] = await getPool().query<RowDataPacket[]>(
      `SELECT ${COLUMNS} FROM announcements ${order}`,
      [fetchLimit],
    );
    return rows.map(toAnnouncement);
  }

  const postedAt = toDbTimestamp(cursor.postedAt);
  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM announcements
      WHERE posted_at < ? OR (posted_at = ? AND id < ?)
      ${order}`,
    [postedAt, postedAt, cursor.id, fetchLimit],
  );
  return rows.map(toAnnouncement);
}

export async function findAnnouncementById(id: string): Promise<Announcement | null> {
  const [rows] = await getPool().execute<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM announcements WHERE id = ?`,
    [id],
  );
  const row = rows[0];
  return row === undefined ? null : toAnnouncement(row);
}

export async function insertAnnouncement(body: string, createdBy: string): Promise<Announcement> {
  const id = randomUUID();
  const now = dbNow();
  await getPool().execute(
    `INSERT INTO announcements (id, body, posted_at, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, body, now, createdBy, now, now],
  );
  const created = await findAnnouncementById(id);
  if (created === null) {
    throw new Error('Announcement disappeared immediately after insert.');
  }
  return created;
}

/** Edits the body only; `posted_at` is fixed at creation (plan D18). */
export async function updateAnnouncementBody(
  id: string,
  body: string,
): Promise<Announcement | null> {
  await getPool().execute('UPDATE announcements SET body = ?, updated_at = ? WHERE id = ?', [
    body,
    dbNow(),
    id,
  ]);
  return findAnnouncementById(id);
}

export async function deleteAnnouncement(id: string): Promise<boolean> {
  const [result] = await getPool().execute<ResultSetHeader>(
    'DELETE FROM announcements WHERE id = ?',
    [id],
  );
  return result.affectedRows > 0;
}
