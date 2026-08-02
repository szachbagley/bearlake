/**
 * Domain shapes as the application sees them: camelCase, booleans as booleans,
 * timestamps as ISO-8601 UTC strings. Query modules convert database rows into
 * these at the edge, so nothing above db/ handles a raw row.
 */

export type UserRole = 'admin' | 'member';

export interface User {
  id: string;
  displayName: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  mustChangePassword: boolean;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewUser {
  displayName: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  mustChangePassword: boolean;
  isActive: boolean;
}

/**
 * Why a refresh token stopped being valid. Only `rotated` is evidence of
 * theft when the token is presented again — see migration 002.
 */
export type RevocationReason =
  | 'rotated'
  | 'logout'
  | 'password_change'
  | 'admin_reset'
  | 'deactivated'
  | 'theft';

export interface RefreshToken {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  revokedAt: string | null;
  revokedReason: RevocationReason | null;
  createdAt: string;
}

export interface NewRefreshToken {
  userId: string;
  tokenHash: string;
  expiresAt: string;
}

/**
 * An event as the application sees it.
 *
 * `startsAt`/`endsAt` carry two different meanings distinguished by `isAllDay`:
 * for timed events they are ISO-8601 UTC instants; for all-day events they are
 * date-only strings (`YYYY-MM-DD`), with `endsAt` the last day inclusive
 * (plan D15). Query modules produce the correct form; nothing above db/ parses
 * them.
 */
export interface Event {
  id: string;
  title: string;
  notes: string | null;
  startsAt: string;
  endsAt: string;
  isAllDay: boolean;
  createdBy: string;
  creatorDisplayName: string;
  createdAt: string;
  updatedAt: string;
}

/** Column values for writing an event. `startsAt`/`endsAt` are in API form. */
export interface EventWrite {
  title: string;
  notes: string | null;
  startsAt: string;
  endsAt: string;
  isAllDay: boolean;
}

/**
 * A home-screen announcement. `body` may contain gate codes and passcodes, so
 * it is treated as sensitive in logs (spec §6.5). `postedAt` is set by the
 * server at creation and is the displayed date; it is not editable.
 */
export interface Announcement {
  id: string;
  body: string;
  postedAt: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * A short reference item on the Information screen — gate codes, where keys
 * live. Also sensitive in logs. Ordered by `sortOrder`, then creation.
 */
export interface QuickTip {
  id: string;
  body: string;
  sortOrder: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** A knowledge-base category. */
export interface InfoCategory {
  id: string;
  title: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export type ArticleStatus = 'draft' | 'published';

/**
 * A content block (spec §4.2). The server knows every block type — it deploys
 * before the clients — so there is no `unknown` case here; that tolerance lives
 * in the iOS renderer. Image blocks store the S3 object key; the resolved URL
 * is added only on the way out (plan D24), never persisted.
 */
export type Block =
  | { id: string; type: 'heading'; text: string }
  | { id: string; type: 'paragraph'; text: string }
  | { id: string; type: 'bullets'; items: string[] }
  | { id: string; type: 'image'; key: string; caption?: string | undefined }
  | { id: string; type: 'video'; provider: 'youtube'; videoId: string; caption?: string | undefined };

/** An image block as sent to clients: the stored key plus a transient URL. */
export type ApiBlock = Block | (Extract<Block, { type: 'image' }> & { url: string });

/** The lightweight shape returned by the category article list (plan D22). */
export interface ArticleSummary {
  id: string;
  categoryId: string;
  title: string;
  status: ArticleStatus;
  sortOrder: number;
  updatedAt: string;
}

/** A full knowledge-base article, blocks included. */
export interface InfoArticle {
  id: string;
  categoryId: string;
  title: string;
  blocks: Block[];
  schemaVersion: number;
  status: ArticleStatus;
  sortOrder: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** Column values for writing an article; `blocks` is the validated array. */
export interface ArticleWrite {
  categoryId: string;
  title: string;
  blocks: Block[];
  status: ArticleStatus;
  sortOrder: number;
}
