import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_UPLOAD_CONTENT_TYPES,
  ANNOUNCEMENT_BODY_MAX,
  ANNOUNCEMENT_LIST_LIMIT_DEFAULT,
  ANNOUNCEMENT_LIST_LIMIT_MAX,
  ARTICLE_TITLE_MAX,
  BLOCK_CAPTION_MAX,
  BULLET_ITEMS_MAX,
  BULLET_ITEM_TEXT_MAX,
  CATEGORY_TITLE_MAX,
  EVENT_NOTES_MAX,
  EVENT_RANGE_MAX_WINDOW_DAYS,
  EVENT_TITLE_MAX,
  HEADING_TEXT_MAX,
  IMAGE_KEY_PATTERN,
  MAX_BLOCKS_PER_ARTICLE,
  MAX_UPLOAD_BYTES,
  PARAGRAPH_TEXT_MAX,
  QUICK_TIP_BODY_MAX,
  USER_DISPLAY_NAME_MAX,
  YOUTUBE_ID_PATTERN,
} from '../src/types/limits.ts';

/**
 * Reads the server's actual schema source (plan W5) and asserts every
 * mirrored constant in limits.ts still matches. This test exists to fail
 * loudly the day the server changes a cap — silence here means the web app
 * has silently drifted from what the API actually enforces.
 *
 * Deliberately text-based, not an import of the server's zod objects: the two
 * apps are independent builds with no shared module resolution (CLAUDE.md
 * forbids workspace tooling), so "read the file and check the substring" is
 * the dependency-free way to keep this honest.
 */

// Resolved via node:path, not `new URL(relative, import.meta.url)`: under
// Vitest's jsdom test environment the global URL constructor is jsdom's own
// WHATWG polyfill, not Node's, and it does not reliably resolve a relative
// path against a file: base the same way — fileURLToPath(import.meta.url)
// alone (no relative resolution) sidesteps that entirely.
const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMAS_DIR = resolve(HERE, '../../bearlake-server/src/schemas');

function readServerSchema(filename: string): string {
  return readFileSync(resolve(SCHEMAS_DIR, filename), 'utf8');
}

const articles = readServerSchema('articles.ts');
const uploads = readServerSchema('uploads.ts');
const events = readServerSchema('events.ts');
const announcements = readServerSchema('announcements.ts');
const quickTips = readServerSchema('quickTips.ts');
const users = readServerSchema('users.ts');

describe('drift: schemas/articles.ts', () => {
  it('MAX_BLOCKS_PER_ARTICLE', () => {
    expect(articles).toContain(`export const MAX_BLOCKS_PER_ARTICLE = ${String(MAX_BLOCKS_PER_ARTICLE)};`);
  });

  it('IMAGE_KEY_PATTERN', () => {
    expect(articles).toContain(`export const IMAGE_KEY_PATTERN = ${String(IMAGE_KEY_PATTERN)};`);
  });

  it('YOUTUBE_ID_PATTERN', () => {
    expect(articles).toContain(`export const YOUTUBE_ID_PATTERN = ${String(YOUTUBE_ID_PATTERN)};`);
  });

  it('heading text max, anchored to the heading block definition', () => {
    const match = /type:\s*z\.literal\('heading'\)[\s\S]{0,120}?\.max\((\d+)\)/.exec(articles);
    expect(match, 'could not find the heading block field in the server source').not.toBeNull();
    expect(Number(match?.[1])).toBe(HEADING_TEXT_MAX);
  });

  it('paragraph text max, anchored to the paragraph block definition', () => {
    // [\d_]+, not \d+: the server writes this cap as 10_000 with a numeric
    // separator, which \d+ would stop matching at the underscore and miss
    // entirely.
    const match = /type:\s*z\.literal\('paragraph'\)[\s\S]{0,120}?\.max\(([\d_]+)\)/.exec(
      articles,
    );
    expect(match, 'could not find the paragraph block field in the server source').not.toBeNull();
    expect(Number((match?.[1] ?? '').replace(/_/g, ''))).toBe(PARAGRAPH_TEXT_MAX);
  });

  it('bullets item max and array max, anchored to the bullets block definition', () => {
    const match =
      /type:\s*z\.literal\('bullets'\)[\s\S]{0,40}?items:\s*z\.array\(z\.string\(\)\.min\(\d+\)\.max\((\d+)\)\)\.min\(\d+\)\.max\((\d+)\)/.exec(
        articles,
      );
    expect(match, 'could not find the bullets block field in the server source').not.toBeNull();
    expect(Number(match?.[1])).toBe(BULLET_ITEM_TEXT_MAX);
    expect(Number(match?.[2])).toBe(BULLET_ITEMS_MAX);
  });

  it('caption max, shared by image and video blocks', () => {
    const match = /const caption = z\.string\(\)\.max\((\d+)\)\.optional\(\);/.exec(articles);
    expect(match, 'could not find the caption field in the server source').not.toBeNull();
    expect(Number(match?.[1])).toBe(BLOCK_CAPTION_MAX);
  });

  it('category title max', () => {
    const match = /createCategorySchema = z\.strictObject\(\{[\s\S]{0,120}?\.max\((\d+)\)/.exec(
      articles,
    );
    expect(match, 'could not find createCategorySchema in the server source').not.toBeNull();
    expect(Number(match?.[1])).toBe(CATEGORY_TITLE_MAX);
  });

  it('article title max', () => {
    const match =
      /const titleSchema = z\.string\(\)\.trim\(\)\.min\(1, 'is required'\)\.max\((\d+)\);/.exec(
        articles,
      );
    expect(match, 'could not find the article titleSchema in the server source').not.toBeNull();
    expect(Number(match?.[1])).toBe(ARTICLE_TITLE_MAX);
  });
});

describe('drift: schemas/uploads.ts', () => {
  it('ALLOWED_UPLOAD_CONTENT_TYPES', () => {
    const match = /export const ALLOWED_UPLOAD_CONTENT_TYPES = (\[[^\]]*\]) as const;/.exec(
      uploads,
    );
    expect(match, 'could not find ALLOWED_UPLOAD_CONTENT_TYPES in the server source').not.toBeNull();
    const serverTypes = JSON.parse(
      (match?.[1] ?? '').replace(/'/g, '"'),
    ) as unknown;
    expect(serverTypes).toEqual([...ALLOWED_UPLOAD_CONTENT_TYPES]);
  });

  it('MAX_UPLOAD_BYTES', () => {
    expect(uploads).toContain('export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;');
    expect(MAX_UPLOAD_BYTES).toBe(10 * 1024 * 1024);
  });
});

describe('drift: schemas/events.ts', () => {
  it('MAX_WINDOW_DAYS (the range-query cap)', () => {
    const match = /const MAX_WINDOW_DAYS = (\d+);/.exec(events);
    expect(match, 'could not find MAX_WINDOW_DAYS in the server source').not.toBeNull();
    expect(Number(match?.[1])).toBe(EVENT_RANGE_MAX_WINDOW_DAYS);
  });

  it('event title max', () => {
    const match =
      /const titleSchema = z\.string\(\)\.trim\(\)\.min\(1, 'is required'\)\.max\((\d+)\);/.exec(
        events,
      );
    expect(match, 'could not find the event titleSchema in the server source').not.toBeNull();
    expect(Number(match?.[1])).toBe(EVENT_TITLE_MAX);
  });

  it('event notes max', () => {
    const match = /const notesSchema = z\.string\(\)\.max\((\d+)\)\.nullish\(\);/.exec(events);
    expect(match, 'could not find notesSchema in the server source').not.toBeNull();
    expect(Number(match?.[1])).toBe(EVENT_NOTES_MAX);
  });
});

describe('drift: schemas/announcements.ts', () => {
  it('announcement body max', () => {
    const match = /body:\s*z\.string\(\)\.trim\(\)\.min\(1, 'is required'\)\.max\((\d+)\)/.exec(
      announcements,
    );
    expect(match, 'could not find the announcement body field in the server source').not.toBeNull();
    expect(Number(match?.[1])).toBe(ANNOUNCEMENT_BODY_MAX);
  });

  it('list limit max and default', () => {
    const match = /limit:\s*z\.coerce\.number\(\)\.int\(\)\.min\(1\)\.max\((\d+)\)\.default\((\d+)\)/.exec(
      announcements,
    );
    expect(match, 'could not find the announcements limit query field in the server source').not.toBeNull();
    expect(Number(match?.[1])).toBe(ANNOUNCEMENT_LIST_LIMIT_MAX);
    expect(Number(match?.[2])).toBe(ANNOUNCEMENT_LIST_LIMIT_DEFAULT);
  });
});

describe('drift: schemas/quickTips.ts', () => {
  it('quick tip body max', () => {
    const match = /body:\s*z\.string\(\)\.trim\(\)\.min\(1, 'is required'\)\.max\((\d+)\)/.exec(
      quickTips,
    );
    expect(match, 'could not find the quick tip body field in the server source').not.toBeNull();
    expect(Number(match?.[1])).toBe(QUICK_TIP_BODY_MAX);
  });
});

describe('drift: schemas/users.ts', () => {
  it('displayName max', () => {
    const match =
      /displayName:\s*z\.string\(\)\.trim\(\)\.min\(1, 'is required'\)\.max\((\d+)\)/.exec(users);
    expect(match, 'could not find the user displayName field in the server source').not.toBeNull();
    expect(Number(match?.[1])).toBe(USER_DISPLAY_NAME_MAX);
  });
});
