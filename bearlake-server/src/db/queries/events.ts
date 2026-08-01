import { randomUUID } from 'node:crypto';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { Event, EventWrite } from '../../types/domain.js';
import {
  dbNow,
  toApiDateOnly,
  toApiTimestamp,
  toBoolean,
  toDbBoolean,
  toDbDateOnly,
  toDbTimestamp,
} from '../mapper.js';
import { getPool } from '../pool.js';

/**
 * All SQL touching `events` lives here. Every statement is parameterized.
 *
 * The join to `users` supplies `creatorDisplayName` so clients can label an
 * event's owner without a second request. `created_by` restricts deletion of a
 * user (migration 001), so the join always finds a row.
 */

const SELECT =
  `SELECT e.id, e.title, e.notes, e.starts_at, e.ends_at, e.is_all_day,
          e.created_by, u.display_name AS creator_display_name,
          e.created_at, e.updated_at
     FROM events e
     JOIN users u ON u.id = e.created_by`;

function toEvent(row: RowDataPacket): Event {
  const isAllDay = toBoolean(row['is_all_day']);
  const startsRaw = String(row['starts_at']);
  const endsRaw = String(row['ends_at']);
  return {
    id: String(row['id']),
    title: String(row['title']),
    notes: row['notes'] === null ? null : String(row['notes']),
    // The stored columns are identical; the meaning is not. An all-day event is
    // a pair of calendar dates, a timed event a pair of instants.
    startsAt: isAllDay ? toApiDateOnly(startsRaw) : toApiTimestamp(startsRaw),
    endsAt: isAllDay ? toApiDateOnly(endsRaw) : toApiTimestamp(endsRaw),
    isAllDay,
    createdBy: String(row['created_by']),
    creatorDisplayName: String(row['creator_display_name']),
    createdAt: toApiTimestamp(String(row['created_at'])),
    updatedAt: toApiTimestamp(String(row['updated_at'])),
  };
}

/** API-form start/end → the stored DATETIME string, per the event's kind. */
function toDbBounds(input: Pick<EventWrite, 'isAllDay' | 'startsAt' | 'endsAt'>): {
  starts: string;
  ends: string;
} {
  return input.isAllDay
    ? { starts: toDbDateOnly(input.startsAt), ends: toDbDateOnly(input.endsAt) }
    : { starts: toDbTimestamp(input.startsAt), ends: toDbTimestamp(input.endsAt) };
}

export async function insertEvent(input: EventWrite, createdBy: string): Promise<Event> {
  const id = randomUUID();
  const now = dbNow();
  const { starts, ends } = toDbBounds(input);

  await getPool().execute(
    `INSERT INTO events
       (id, title, notes, starts_at, ends_at, is_all_day, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.title, input.notes, starts, ends, toDbBoolean(input.isAllDay), createdBy, now, now],
  );

  const created = await findEventById(id);
  if (created === null) {
    throw new Error('Event disappeared immediately after insert.');
  }
  return created;
}

export async function findEventById(id: string): Promise<Event | null> {
  const [rows] = await getPool().execute<RowDataPacket[]>(`${SELECT} WHERE e.id = ?`, [id]);
  const row = rows[0];
  return row === undefined ? null : toEvent(row);
}

export interface RangeQuery {
  /** Window bounds as ISO instants; timed events use these directly. */
  startInstant: string;
  endInstant: string;
  /** The Denver calendar dates the window covers; all-day events use these. */
  windowFirstDate: string;
  windowLastDate: string;
}

/**
 * Events overlapping the window (plan D16).
 *
 * Two clauses, because the two kinds of event live in different spaces. Timed
 * events overlap on the half-open instant interval — the `< end` / `> start`
 * that returns events starting before or ending after the window without the
 * classic boundary double-count. All-day events overlap on the inclusive
 * Denver date range, compared with `DATE()` against the naive stored midnight
 * so no timezone conversion touches them.
 */
export async function listEventsInRange(query: RangeQuery): Promise<Event[]> {
  const start = toDbTimestamp(query.startInstant);
  const end = toDbTimestamp(query.endInstant);

  const [rows] = await getPool().execute<RowDataPacket[]>(
    `${SELECT}
      WHERE (e.is_all_day = 0 AND e.starts_at < ? AND e.ends_at > ?)
         OR (e.is_all_day = 1 AND DATE(e.starts_at) <= ? AND DATE(e.ends_at) >= ?)
      ORDER BY e.starts_at ASC, e.id ASC`,
    [end, start, query.windowLastDate, query.windowFirstDate],
  );

  return rows.map(toEvent);
}

export async function updateEvent(id: string, input: EventWrite): Promise<Event | null> {
  const { starts, ends } = toDbBounds(input);

  await getPool().execute(
    `UPDATE events
        SET title = ?, notes = ?, starts_at = ?, ends_at = ?, is_all_day = ?, updated_at = ?
      WHERE id = ?`,
    [input.title, input.notes, starts, ends, toDbBoolean(input.isAllDay), dbNow(), id],
  );

  return findEventById(id);
}

export async function deleteEvent(id: string): Promise<boolean> {
  const [result] = await getPool().execute<ResultSetHeader>('DELETE FROM events WHERE id = ?', [
    id,
  ]);
  return result.affectedRows > 0;
}
