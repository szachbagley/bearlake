import type { ApiBlock, Block } from '../types/domain.js';

/**
 * Resolves image block keys to presigned URLs on the way out (plan D24).
 *
 * Phase 6 ships a stub: it produces a deterministic placeholder URL so the
 * knowledge-base API is complete and testable without S3. Phase 7 replaces the
 * body of `presignImageGet` with a real presigned S3 GET (15-minute expiry).
 * Everything else — the block mapping, the contract that the stored key is
 * retained and the URL is transient — stays exactly as it is here.
 */

const PRESIGN_TTL_SECONDS = 15 * 60;

export interface ImageUrlResolver {
  presignImageGet(key: string): Promise<string>;
}

/**
 * The stub resolver. The URL is obviously not a real S3 endpoint, so a stub
 * leaking into somewhere it shouldn't is easy to spot, while still embedding
 * the key and an expiry the way the real one will.
 */
export const stubImageUrlResolver: ImageUrlResolver = {
  presignImageGet(key: string): Promise<string> {
    const expires = Math.floor(Date.now() / 1000) + PRESIGN_TTL_SECONDS;
    return Promise.resolve(`https://images.invalid/${key}?stub-expires=${String(expires)}`);
  },
};

let resolver: ImageUrlResolver = stubImageUrlResolver;

/** Phase 7 (and tests) swap in a different resolver here. */
export function setImageUrlResolver(next: ImageUrlResolver): void {
  resolver = next;
}

/**
 * Returns the blocks with each image block augmented by a transient `url`
 * alongside its stored `key`. Non-image blocks pass through untouched, so an
 * article round-trips structurally identical apart from the added URLs.
 */
export async function withImageUrls(blocks: Block[]): Promise<ApiBlock[]> {
  return Promise.all(
    blocks.map(async (block): Promise<ApiBlock> => {
      if (block.type !== 'image') return block;
      return { ...block, url: await resolver.presignImageGet(block.key) };
    }),
  );
}
