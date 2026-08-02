import type { AnnouncementCursor } from '../db/queries/announcements.js';
import { ValidationError } from '../types/errors.js';

/**
 * Opaque keyset cursor for announcement pagination (plan D18).
 *
 * The cursor is base64url of `postedAt|id`. It is opaque to the client — the
 * encoding is an implementation detail — but it must round-trip exactly, so a
 * tampered or truncated cursor is rejected rather than silently returning the
 * wrong page. A UUID and an ISO timestamp both contain no `|`, so the first
 * separator splits the two cleanly.
 */

const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeCursor(cursor: AnnouncementCursor): string {
  return Buffer.from(`${cursor.postedAt}|${cursor.id}`, 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): AnnouncementCursor {
  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  const separator = decoded.indexOf('|');
  if (separator === -1) {
    throw new ValidationError('That page cursor is not valid.');
  }

  const postedAt = decoded.slice(0, separator);
  const id = decoded.slice(separator + 1);

  if (!ISO_PATTERN.test(postedAt) || !UUID_PATTERN.test(id)) {
    throw new ValidationError('That page cursor is not valid.');
  }

  return { postedAt, id };
}
