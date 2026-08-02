import { z } from 'zod';

/**
 * The block schema (spec §4, plan D20) — the server's copy of the contract
 * shared with the React editor, the iOS editor, and the iOS renderer.
 *
 * The server deploys before the clients, so it always knows the full set of
 * block types and validates strictly: an unrecognized `type` is a 400, not a
 * tolerated unknown. The tolerance for unknown types lives on the read side of
 * the older *clients*, never here. Block content is never transformed (no
 * trim, no normalization), so an untouched article round-trips byte-identical.
 */

/** `articles/{articleId}/{uuid}` — the upload namespace (plan D25). */
export const IMAGE_KEY_PATTERN = /^articles\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/;
/** A YouTube video id is exactly 11 URL-safe base64 characters. */
export const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

export const MAX_BLOCKS_PER_ARTICLE = 200;

const blockId = z.string().uuid('block id must be a UUID');
const caption = z.string().max(300).optional();

const headingBlock = z.strictObject({
  id: blockId,
  type: z.literal('heading'),
  // min(1) rejects an empty heading, which renders as nothing; max is D20.
  text: z.string().min(1).max(200),
});

const paragraphBlock = z.strictObject({
  id: blockId,
  type: z.literal('paragraph'),
  text: z.string().min(1).max(10_000),
});

const bulletsBlock = z.strictObject({
  id: blockId,
  type: z.literal('bullets'),
  items: z.array(z.string().min(1).max(500)).min(1).max(100),
});

const imageBlock = z.strictObject({
  id: blockId,
  type: z.literal('image'),
  key: z.string().regex(IMAGE_KEY_PATTERN, 'is not a valid image key'),
  caption,
});

const videoBlock = z.strictObject({
  id: blockId,
  type: z.literal('video'),
  provider: z.literal('youtube'),
  videoId: z.string().regex(YOUTUBE_ID_PATTERN, 'is not a valid YouTube video id'),
  caption,
});

const block = z.discriminatedUnion('type', [
  headingBlock,
  paragraphBlock,
  bulletsBlock,
  imageBlock,
  videoBlock,
]);

export const blocksSchema = z
  .array(block)
  .max(MAX_BLOCKS_PER_ARTICLE)
  .superRefine((blocks, ctx) => {
    // Block ids must be unique within an article: reordering, editing, and
    // React keys all rely on stable per-block identity (spec §4.3).
    const seen = new Set<string>();
    for (const [index, b] of blocks.entries()) {
      if (seen.has(b.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'block ids must be unique within an article',
          path: [index, 'id'],
        });
      }
      seen.add(b.id);
    }
  });

const titleSchema = z.string().trim().min(1, 'is required').max(200);
const statusSchema = z.enum(['draft', 'published']);

// ── Categories ──────────────────────────────────────────────────────────────

export const categoryIdParamSchema = z.object({
  id: z.string().uuid('must be a valid id'),
});

export const createCategorySchema = z.strictObject({
  title: z.string().trim().min(1, 'is required').max(100),
  sortOrder: z.number().int().optional(),
});

export const updateCategorySchema = z
  .strictObject({
    title: z.string().trim().min(1).max(100).optional(),
    sortOrder: z.number().int().optional(),
  })
  .refine((patch) => Object.values(patch).some((v) => v !== undefined), {
    message: 'Provide at least one field to change.',
  });

// ── Articles ────────────────────────────────────────────────────────────────

export const articleIdParamSchema = z.object({
  id: z.string().uuid('must be a valid id'),
});

export const createArticleSchema = z.strictObject({
  categoryId: z.string().uuid('must be a valid category id'),
  title: titleSchema,
  blocks: blocksSchema,
  status: statusSchema,
  sortOrder: z.number().int().optional(),
  // schemaVersion is intentionally absent: the server stamps it (plan D21).
});

/**
 * A patch must carry the `updatedAt` the client loaded (plan D23) so a stale
 * write is rejected rather than silently overwriting a concurrent edit, and at
 * least one field to actually change.
 */
export const updateArticleSchema = z
  .strictObject({
    categoryId: z.string().uuid().optional(),
    title: titleSchema.optional(),
    blocks: blocksSchema.optional(),
    status: statusSchema.optional(),
    sortOrder: z.number().int().optional(),
    updatedAt: z.string().datetime({ message: 'must be an ISO-8601 timestamp' }),
  })
  .refine(
    ({ updatedAt: _updatedAt, ...rest }) => Object.values(rest).some((v) => v !== undefined),
    { message: 'Provide at least one field to change.' },
  );

export type CreateArticleInput = z.infer<typeof createArticleSchema>;
export type UpdateArticleInput = z.infer<typeof updateArticleSchema>;
