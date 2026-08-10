import type { HeadingBlock } from '../../../types/blocks.ts';
import { HEADING_TEXT_MAX } from '../../../types/limits.ts';

export function HeadingBlockEditor({
  block,
  onChange,
}: {
  block: HeadingBlock;
  onChange: (next: HeadingBlock) => void;
}) {
  return (
    <div className="field">
      <label htmlFor={`block-${block.id}-text`}>Heading</label>
      <input
        id={`block-${block.id}-text`}
        type="text"
        value={block.text}
        onChange={(e) => onChange({ ...block, text: e.target.value })}
      />
      <p className="field-hint">
        {block.text.length} / {HEADING_TEXT_MAX}
      </p>
    </div>
  );
}
