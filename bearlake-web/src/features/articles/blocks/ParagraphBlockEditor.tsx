import type { ParagraphBlock } from '../../../types/blocks.ts';
import { PARAGRAPH_TEXT_MAX } from '../../../types/limits.ts';

/** No formatting toolbar (CLAUDE.md: blocks carry no inline formatting) —
 * a plain textarea is the entire editor. */
export function ParagraphBlockEditor({
  block,
  onChange,
}: {
  block: ParagraphBlock;
  onChange: (next: ParagraphBlock) => void;
}) {
  return (
    <div className="field">
      <label htmlFor={`block-${block.id}-text`}>Paragraph</label>
      <textarea
        id={`block-${block.id}-text`}
        rows={4}
        value={block.text}
        onChange={(e) => onChange({ ...block, text: e.target.value })}
      />
      <p className="field-hint">
        {block.text.length} / {PARAGRAPH_TEXT_MAX}
      </p>
    </div>
  );
}
