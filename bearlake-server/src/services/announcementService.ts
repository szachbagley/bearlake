import {
  deleteAnnouncement,
  findAnnouncementById,
  insertAnnouncement,
  listAnnouncements,
  updateAnnouncementBody,
} from '../db/queries/announcements.js';
import type { Announcement } from '../types/domain.js';
import { InternalError, NotFoundError } from '../types/errors.js';
import { decodeCursor, encodeCursor } from './cursor.js';

/**
 * Announcement business logic. Reads are open to any member; writes are
 * admin-only, enforced by middleware on the routes.
 */

export interface AnnouncementPage {
  items: Announcement[];
  /** Null when this is the last page. */
  nextCursor: string | null;
}

/**
 * A page of announcements, newest first.
 *
 * One extra row beyond the page size is fetched to detect a further page
 * without a second query; if it comes back, the page is trimmed to `limit` and
 * a cursor is built from the last item actually returned.
 */
export async function list(limit: number, rawCursor: string | undefined): Promise<AnnouncementPage> {
  const cursor = rawCursor === undefined ? null : decodeCursor(rawCursor);
  const rows = await listAnnouncements(limit + 1, cursor);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);

  return {
    items,
    nextCursor: hasMore && last !== undefined ? encodeCursor({ postedAt: last.postedAt, id: last.id }) : null,
  };
}

export async function create(body: string, createdBy: string): Promise<Announcement> {
  return insertAnnouncement(body, createdBy);
}

export async function update(id: string, body: string): Promise<Announcement> {
  const existing = await findAnnouncementById(id);
  if (existing === null) {
    throw new NotFoundError('That announcement could not be found.');
  }
  const updated = await updateAnnouncementBody(id, body);
  if (updated === null) {
    throw new InternalError();
  }
  return updated;
}

export async function remove(id: string): Promise<void> {
  const deleted = await deleteAnnouncement(id);
  if (!deleted) {
    throw new NotFoundError('That announcement could not be found.');
  }
}
