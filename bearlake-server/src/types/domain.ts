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
