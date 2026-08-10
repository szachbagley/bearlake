import type { ApiImageBlock } from '../../../types/blocks.ts';
import { BLOCK_CAPTION_MAX } from '../../../types/limits.ts';

/**
 * Renders from the transient `url` the API attaches at read time (plan
 * W25) — never the stored `key` directly, since the bucket is private.
 * Replacing the photo isn't offered here: delete this block and add a new
 * one, which reuses the same upload pipeline rather than a second one.
 */
export function ImageBlockEditor({
  block,
  onChange,
}: {
  block: ApiImageBlock;
  onChange: (next: ApiImageBlock) => void;
}) {
  return (
    <div className="field">
      <img
        src={block.url}
        alt={block.caption ?? 'Article image'}
        style={{ maxWidth: '100%', maxHeight: '16rem', borderRadius: 'var(--radius)' }}
      />
      <label htmlFor={`block-${block.id}-caption`}>Caption (optional)</label>
      <input
        id={`block-${block.id}-caption`}
        type="text"
        value={block.caption ?? ''}
        onChange={(e) =>
          onChange({ ...block, caption: e.target.value.length > 0 ? e.target.value : undefined })
        }
      />
      <p className="field-hint">
        {(block.caption ?? '').length} / {BLOCK_CAPTION_MAX}
      </p>
    </div>
  );
}
