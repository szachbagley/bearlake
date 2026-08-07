import { z } from 'zod';
import {
  BLOCK_CAPTION_MAX,
  BULLET_ITEMS_MAX,
  BULLET_ITEMS_MIN,
  BULLET_ITEM_TEXT_MAX,
  BULLET_ITEM_TEXT_MIN,
  HEADING_TEXT_MAX,
  HEADING_TEXT_MIN,
  IMAGE_KEY_PATTERN,
  MAX_BLOCKS_PER_ARTICLE,
  PARAGRAPH_TEXT_MAX,
  PARAGRAPH_TEXT_MIN,
  YOUTUBE_ID_PATTERN,
} from './limits.ts';

/**
 * The block schema (spec §4.2), mirroring bearlake-server/src/schemas/articles.ts.
 * Every numeric cap and pattern comes from limits.ts, so a server change is
 * caught by the drift test rather than silently diverging here.
 */

export const KNOWN_BLOCK_TYPES = ['heading', 'paragraph', 'bullets', 'image', 'video'] as const;
export type KnownBlockType = (typeof KNOWN_BLOCK_TYPES)[number];

export function isKnownBlockType(type: string): type is KnownBlockType {
  return (KNOWN_BLOCK_TYPES as readonly string[]).includes(type);
}

const blockId = z.string().uuid('block id must be a UUID');
const caption = z.string().max(BLOCK_CAPTION_MAX).optional();

export const headingBlockSchema = z.strictObject({
  id: blockId,
  type: z.literal('heading'),
  text: z.string().min(HEADING_TEXT_MIN).max(HEADING_TEXT_MAX),
});

export const paragraphBlockSchema = z.strictObject({
  id: blockId,
  type: z.literal('paragraph'),
  text: z.string().min(PARAGRAPH_TEXT_MIN).max(PARAGRAPH_TEXT_MAX),
});

export const bulletsBlockSchema = z.strictObject({
  id: blockId,
  type: z.literal('bullets'),
  items: z
    .array(z.string().min(BULLET_ITEM_TEXT_MIN).max(BULLET_ITEM_TEXT_MAX))
    .min(BULLET_ITEMS_MIN)
    .max(BULLET_ITEMS_MAX),
});

export const imageBlockSchema = z.strictObject({
  id: blockId,
  type: z.literal('image'),
  key: z.string().regex(IMAGE_KEY_PATTERN, 'is not a valid image key'),
  caption,
});

export const videoBlockSchema = z.strictObject({
  id: blockId,
  type: z.literal('video'),
  provider: z.literal('youtube'),
  videoId: z.string().regex(YOUTUBE_ID_PATTERN, 'is not a valid YouTube video id'),
  caption,
});

export const knownBlockSchema = z.discriminatedUnion('type', [
  headingBlockSchema,
  paragraphBlockSchema,
  bulletsBlockSchema,
  imageBlockSchema,
  videoBlockSchema,
]);

/**
 * A block whose `type` this build does not recognize (plan W23, spec §4.3).
 * Preserved read-only in the editor and round-tripped unchanged on save —
 * `.looseObject` keeps every field it doesn't know about rather than
 * stripping them. The `type` refinement rejects any value that IS a known
 * type, so a malformed *known* block (e.g. a heading missing `text`) is
 * correctly reported as invalid rather than silently reclassified as
 * "unknown and fine."
 */
export const unknownBlockSchema = z
  .looseObject({
    id: blockId,
    type: z.string(),
  })
  .refine((b) => !isKnownBlockType(b.type), {
    message: 'a recognized block type must match its own schema, not the unknown fallback',
    path: ['type'],
  });

export const blockSchema = z.union([knownBlockSchema, unknownBlockSchema]);

/**
 * The full block array: capped, and every id unique within the article —
 * mirrors the server's array-level checks exactly (plan D20).
 */
export const blocksSchema = z
  .array(blockSchema)
  .max(MAX_BLOCKS_PER_ARTICLE)
  .superRefine((blocks, ctx) => {
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

export type HeadingBlock = z.infer<typeof headingBlockSchema>;
export type ParagraphBlock = z.infer<typeof paragraphBlockSchema>;
export type BulletsBlock = z.infer<typeof bulletsBlockSchema>;
export type ImageBlock = z.infer<typeof imageBlockSchema>;
export type VideoBlock = z.infer<typeof videoBlockSchema>;
export type KnownBlock = z.infer<typeof knownBlockSchema>;
export type UnknownBlock = z.infer<typeof unknownBlockSchema>;
export type Block = z.infer<typeof blockSchema>;

/** An image block as returned by the API: the stored key plus a transient,
 * presigned `url` (plan D24/W25). Never write `url` back to the server. */
export type ApiImageBlock = ImageBlock & { url: string };
export type ApiBlock = Exclude<Block, ImageBlock> | ApiImageBlock;

/** Strips the transient `url` the API attaches to image blocks (plan W25) —
 * call this on every block array before a PATCH/POST body is built. */
export function stripImageUrls(blocks: ApiBlock[]): Block[] {
  return blocks.map((block) => {
    if (block.type !== 'image') return block;
    const { url: _url, ...rest } = block;
    return rest;
  });
}
