import { useState } from 'react';
import { ConfirmDialog } from '../../../components/ConfirmDialog.tsx';
import {
  isKnownBlockType,
  type ApiBlock,
  type ApiImageBlock,
  type ImageBlock,
  type KnownBlock,
} from '../../../types/blocks.ts';
import { BulletsBlockEditor } from './BulletsBlockEditor.tsx';
import { HeadingBlockEditor } from './HeadingBlockEditor.tsx';
import { ImageBlockEditor } from './ImageBlockEditor.tsx';
import { ParagraphBlockEditor } from './ParagraphBlockEditor.tsx';
import { UnknownBlockEditor } from './UnknownBlockEditor.tsx';
import { VideoBlockEditor } from './VideoBlockEditor.tsx';

function typeLabel(type: string): string {
  switch (type) {
    case 'heading':
      return 'Heading';
    case 'paragraph':
      return 'Paragraph';
    case 'bullets':
      return 'Bullet list';
    case 'image':
      return 'Photo';
    case 'video':
      return 'Video';
    default:
      return 'Unsupported block';
  }
}

/**
 * `isKnownBlockType(block.type)` alone doesn't narrow `block` itself — an
 * UnknownBlock's `type` is typed as plain `string`, and its `.refine()`
 * (which is what actually excludes known types) is a runtime check zod
 * doesn't encode in the static type. That makes every known block
 * structurally assignable to UnknownBlock's loose shape too, so
 * `Exclude<ApiBlock, UnknownBlock>` collapses to `never` — this predicate
 * asserts the narrower type directly instead of deriving it that way.
 */
type KnownApiBlock = Exclude<KnownBlock, ImageBlock> | ApiImageBlock;

function isKnownApiBlock(block: ApiBlock): block is KnownApiBlock {
  return isKnownBlockType(block.type);
}

function renderEditor(block: ApiBlock, onChange: (next: ApiBlock) => void) {
  if (!isKnownApiBlock(block)) {
    return <UnknownBlockEditor block={block} />;
  }

  switch (block.type) {
    case 'heading':
      return <HeadingBlockEditor block={block} onChange={onChange} />;
    case 'paragraph':
      return <ParagraphBlockEditor block={block} onChange={onChange} />;
    case 'bullets':
      return <BulletsBlockEditor block={block} onChange={onChange} />;
    case 'image':
      return <ImageBlockEditor block={block} onChange={onChange} />;
    case 'video':
      return <VideoBlockEditor block={block} onChange={onChange} />;
  }
}

/**
 * The reorderable block list (plan step 2): move up/down (keyboard-operable
 * buttons, no drag-and-drop — W20) with an `aria-live` announcement of the
 * new position, delete behind confirmation, and each row's own
 * type-specific editor.
 */
export function BlockList({
  blocks,
  onChange,
  onMove,
  onDelete,
}: {
  blocks: ApiBlock[];
  onChange: (index: number, next: ApiBlock) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onDelete: (index: number) => void;
}) {
  const [announcement, setAnnouncement] = useState('');
  const [pendingDeleteIndex, setPendingDeleteIndex] = useState<number | null>(null);

  function handleMove(index: number, direction: -1 | 1): void {
    onMove(index, direction);
    setAnnouncement(`Moved block to position ${String(index + direction + 1)} of ${String(blocks.length)}.`);
  }

  return (
    <div className="stack">
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
      {blocks.map((block, index) => (
        <div key={block.id} className="card stack">
          <div className="row row--between">
            <span className="text-muted">{typeLabel(block.type)}</span>
            <div className="row">
              <button
                type="button"
                className="btn btn--ghost"
                aria-label="Move block up"
                disabled={index === 0}
                onClick={() => handleMove(index, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                aria-label="Move block down"
                disabled={index === blocks.length - 1}
                onClick={() => handleMove(index, 1)}
              >
                ↓
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                aria-label="Delete block"
                onClick={() => setPendingDeleteIndex(index)}
              >
                Delete
              </button>
            </div>
          </div>
          {renderEditor(block, (next) => onChange(index, next))}
        </div>
      ))}

      {pendingDeleteIndex !== null && (
        <ConfirmDialog
          title="Delete this block?"
          message="This cannot be undone."
          confirmLabel="Delete"
          danger
          onConfirm={() => {
            onDelete(pendingDeleteIndex);
            setPendingDeleteIndex(null);
          }}
          onCancel={() => setPendingDeleteIndex(null)}
        />
      )}
    </div>
  );
}
