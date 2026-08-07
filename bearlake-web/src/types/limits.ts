/**
 * Every shared validation limit and pattern, mirrored from the server's zod
 * schemas (plan W5). This file is the one place these constants live on the
 * web side; `test/drift.test.ts` reads the server's source files and asserts
 * every value here still matches. If the server changes a cap, that test
 * fails loudly instead of the web app silently rejecting (or silently
 * accepting) the wrong thing.
 *
 * Source of truth for each group is named alongside it. Do not hand-edit a
 * value here without updating the server first — this file follows the
 * server, never the other way around.
 */

// ── Articles & blocks (bearlake-server/src/schemas/articles.ts) ────────────

export const CATEGORY_TITLE_MIN = 1;
export const CATEGORY_TITLE_MAX = 100;

export const ARTICLE_TITLE_MIN = 1;
export const ARTICLE_TITLE_MAX = 200;

export const MAX_BLOCKS_PER_ARTICLE = 200;

export const HEADING_TEXT_MIN = 1;
export const HEADING_TEXT_MAX = 200;

export const PARAGRAPH_TEXT_MIN = 1;
export const PARAGRAPH_TEXT_MAX = 10_000;

export const BULLET_ITEMS_MIN = 1;
export const BULLET_ITEMS_MAX = 100;
export const BULLET_ITEM_TEXT_MIN = 1;
export const BULLET_ITEM_TEXT_MAX = 500;

export const BLOCK_CAPTION_MAX = 300;

/** `articles/{articleId}/{uuid}` — the upload namespace (plan D25). */
export const IMAGE_KEY_PATTERN = /^articles\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/;
/** A YouTube video id is exactly 11 URL-safe base64 characters. */
export const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

// ── Uploads (bearlake-server/src/schemas/uploads.ts) ────────────────────────

export const ALLOWED_UPLOAD_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/heic'] as const;
export type AllowedUploadContentType = (typeof ALLOWED_UPLOAD_CONTENT_TYPES)[number];

/** 10 MB. Clients downscale before upload (plan W24); nothing here needs more. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// ── Events (bearlake-server/src/schemas/events.ts) ──────────────────────────

export const EVENT_TITLE_MIN = 1;
export const EVENT_TITLE_MAX = 200;
export const EVENT_NOTES_MAX = 5000;

/** The range query window cap (plan D16/W14). */
export const EVENT_RANGE_MAX_WINDOW_DAYS = 366;

// ── Announcements (bearlake-server/src/schemas/announcements.ts) ───────────

export const ANNOUNCEMENT_BODY_MIN = 1;
export const ANNOUNCEMENT_BODY_MAX = 5000;

export const ANNOUNCEMENT_LIST_LIMIT_MIN = 1;
export const ANNOUNCEMENT_LIST_LIMIT_MAX = 50;
export const ANNOUNCEMENT_LIST_LIMIT_DEFAULT = 20;

// ── Quick tips (bearlake-server/src/schemas/quickTips.ts) ──────────────────

export const QUICK_TIP_BODY_MIN = 1;
export const QUICK_TIP_BODY_MAX = 1000;

// ── Users (bearlake-server/src/schemas/users.ts) ────────────────────────────

export const USER_DISPLAY_NAME_MIN = 1;
export const USER_DISPLAY_NAME_MAX = 100;
