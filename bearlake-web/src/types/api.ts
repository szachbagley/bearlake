import type { AllowedUploadContentType } from './limits.ts';
import type { ApiBlock, Block } from './blocks.ts';

/**
 * The API contract, transcribed from the running server (plan W1 step 1).
 *
 * Request types are **exact** (plan W11): every field the server's
 * `z.strictObject` schema accepts, and nothing else. The server rejects an
 * unknown key with a 400 rather than silently dropping it, so `Partial<Entity>`
 * shortcuts are a bug here, not a convenience.
 *
 * `PublicUser` and `Announcement`/`QuickTip`/etc. carry no `passwordHash` or
 * other server-internal field — this file is the client's view, not a mirror
 * of the server's database rows.
 */

// ── Users ────────────────────────────────────────────────────────────────

export type UserRole = 'admin' | 'member';

export interface PublicUser {
  id: string;
  displayName: string;
  email: string;
  role: UserRole;
  mustChangePassword: boolean;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateUserRequest {
  displayName: string;
  email: string;
  role: UserRole;
}

/** At least one field must be present; enforced by the form, not the type. */
export interface UpdateUserRequest {
  displayName?: string;
  role?: UserRole;
  isActive?: boolean;
}

export interface ListUsersResponse {
  users: PublicUser[];
}

/** The temporary password is returned exactly once, here (plan W31). */
export interface CreateUserResponse {
  user: PublicUser;
  temporaryPassword: string;
}

export interface ResetPasswordResponse {
  temporaryPassword: string;
}

// ── Auth ─────────────────────────────────────────────────────────────────

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RefreshRequest {
  refreshToken: string;
}

export interface LogoutRequest {
  refreshToken: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface SessionResult {
  accessToken: string;
  refreshToken: string;
  user: PublicUser;
}

// ── Events ───────────────────────────────────────────────────────────────

/**
 * Named CalendarEvent, not Event — `Event` is a DOM global and shadowing it
 * invites confusing bugs in files that also touch real browser events.
 */
export interface CalendarEvent {
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

/**
 * Discriminated on `isAllDay` (plan W15). Timed events carry ISO instants
 * with an explicit offset; all-day events carry `YYYY-MM-DD` date-only
 * strings with `endsAt` the last day, inclusive. Mixing shapes is a 400.
 */
export type CreateEventRequest =
  | {
      isAllDay: false;
      title: string;
      notes?: string | null;
      startsAt: string;
      endsAt: string;
    }
  | {
      isAllDay: true;
      title: string;
      notes?: string | null;
      startsAt: string;
      endsAt: string;
    };

/**
 * PATCH is a loose partial on the wire — the server merges it onto the
 * stored event and revalidates the whole thing, so toggling `isAllDay`
 * requires supplying matching startsAt/endsAt in the new shape.
 */
export interface UpdateEventRequest {
  isAllDay?: boolean;
  title?: string;
  notes?: string | null;
  startsAt?: string;
  endsAt?: string;
}

// Both query types extend Record<string, ...> — not to loosen them (the
// server's own query schemas use plain z.object(), not z.strictObject(), so
// there is no strict-body concern for query strings the way there is for
// POST/PATCH bodies), but because request()'s `query` param is genuinely
// keyed-by-string-at-runtime (it becomes URLSearchParams), and a plain
// interface without an index signature is not structurally assignable to
// that shape even when every declared field already fits it.

export interface ListEventsQuery extends Record<string, string | number | undefined> {
  start: string;
  end: string;
}

export interface ListEventsResponse {
  events: CalendarEvent[];
}

// ── Announcements ────────────────────────────────────────────────────────

export interface Announcement {
  id: string;
  body: string;
  postedAt: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAnnouncementRequest {
  body: string;
}

/** `body` is required on update too — `postedAt` is the only fixed field. */
export interface UpdateAnnouncementRequest {
  body: string;
}

export interface ListAnnouncementsQuery extends Record<string, string | number | undefined> {
  limit?: number;
  cursor?: string;
}

export interface AnnouncementPage {
  items: Announcement[];
  /** Null when this is the last page. */
  nextCursor: string | null;
}

// ── Quick tips ───────────────────────────────────────────────────────────

export interface QuickTip {
  id: string;
  body: string;
  sortOrder: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateQuickTipRequest {
  body: string;
  sortOrder?: number;
}

export interface UpdateQuickTipRequest {
  body?: string;
  sortOrder?: number;
}

export interface ListQuickTipsResponse {
  quickTips: QuickTip[];
}

// ── Knowledge base ───────────────────────────────────────────────────────

export interface InfoCategory {
  id: string;
  title: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCategoryRequest {
  title: string;
  sortOrder?: number;
}

export interface UpdateCategoryRequest {
  title?: string;
  sortOrder?: number;
}

export interface ListCategoriesResponse {
  categories: InfoCategory[];
}

export type ArticleStatus = 'draft' | 'published';

/** The lightweight shape returned by the category article list (plan D22) —
 * no blocks, so lists stay light even for a long article. */
export interface ArticleSummary {
  id: string;
  categoryId: string;
  title: string;
  status: ArticleStatus;
  sortOrder: number;
  updatedAt: string;
}

export interface ListArticleSummariesResponse {
  articles: ArticleSummary[];
}

/** The full article, blocks included, with image URLs resolved (plan D24). */
export interface InfoArticle {
  id: string;
  categoryId: string;
  title: string;
  blocks: ApiBlock[];
  schemaVersion: number;
  status: ArticleStatus;
  sortOrder: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** `schemaVersion` is absent — the server stamps it (plan D21); a client
 * that sends it gets a 400 (plan D38's strict-body rule). */
export interface CreateArticleRequest {
  categoryId: string;
  title: string;
  blocks: Block[];
  status: ArticleStatus;
  sortOrder?: number;
}

/** `updatedAt` is **required**, not optional — it is the optimistic-lock
 * token (plan D23/W16). Omitting it is itself a validation error. */
export interface UpdateArticleRequest {
  categoryId?: string;
  title?: string;
  blocks?: Block[];
  status?: ArticleStatus;
  sortOrder?: number;
  updatedAt: string;
}

// ── Uploads ──────────────────────────────────────────────────────────────

export interface PresignUploadRequest {
  articleId: string;
  contentType: AllowedUploadContentType;
  contentLength: number;
}

export interface PresignUploadResponse {
  key: string;
  uploadUrl: string;
}

// ── Errors (plan W13) ────────────────────────────────────────────────────

/**
 * Every code the server can return. `ApiError.code` is typed as a plain
 * `string`, not this union — an unrecognized code (the server adds one before
 * this app is redeployed) must still carry the server's real, display-safe
 * message rather than being coerced into a generic failure. This union exists
 * for exhaustive `switch`/comparison at call sites that handle specific codes.
 */
export const KNOWN_ERROR_CODES = [
  'VALIDATION_ERROR',
  'INVALID_CREDENTIALS',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'PASSWORD_CHANGE_REQUIRED',
  'ACCOUNT_DISABLED',
  'NOT_FOUND',
  'STALE_ARTICLE',
  'CATEGORY_NOT_EMPTY',
  'EMAIL_IN_USE',
  'RATE_LIMITED',
  'PAYLOAD_TOO_LARGE',
  'INTERNAL',
] as const;

export type KnownErrorCode = (typeof KNOWN_ERROR_CODES)[number];

/** Synthesized by the client itself (plan step 5) — the server never sends
 * this. Used when `fetch` throws before any HTTP response exists. */
export const NETWORK_ERROR_CODE = 'NETWORK_ERROR';
