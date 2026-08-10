import type { BulletsBlock } from '../../../types/blocks.ts';
import { BULLET_ITEMS_MAX, BULLET_ITEM_TEXT_MAX } from '../../../types/limits.ts';

/** One input per item, with its own add/remove/reorder (plan step 4) —
 * distinct from the block-level move up/down in BlockList, which reorders
 * whole blocks, not bullets within one. */
export function BulletsBlockEditor({
  block,
  onChange,
}: {
  block: BulletsBlock;
  onChange: (next: BulletsBlock) => void;
}) {
  function setItem(index: number, value: string): void {
    onChange({ ...block, items: block.items.map((item, i) => (i === index ? value : item)) });
  }

  function removeItem(index: number): void {
    onChange({ ...block, items: block.items.filter((_, i) => i !== index) });
  }

  function moveItem(index: number, direction: -1 | 1): void {
    const target = index + direction;
    if (target < 0 || target >= block.items.length) return;
    const items = [...block.items];
    const a = items[index];
    const b = items[target];
    if (a === undefined || b === undefined) return;
    items[index] = b;
    items[target] = a;
    onChange({ ...block, items });
  }

  function addItem(): void {
    onChange({ ...block, items: [...block.items, ''] });
  }

  return (
    <div className="field">
      <span>Bullet list</span>
      <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {block.items.map((item, index) => (
          // Items have no stable identity of their own — index is the
          // array position being edited, which is the correct key here.
          <li key={index} className="row">
            <input
              type="text"
              aria-label={`Bullet ${String(index + 1)}`}
              value={item}
              onChange={(e) => setItem(index, e.target.value)}
            />
            <button
              type="button"
              className="btn btn--ghost"
              aria-label={`Move bullet ${String(index + 1)} up`}
              disabled={index === 0}
              onClick={() => moveItem(index, -1)}
            >
              ↑
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              aria-label={`Move bullet ${String(index + 1)} down`}
              disabled={index === block.items.length - 1}
              onClick={() => moveItem(index, 1)}
            >
              ↓
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              aria-label={`Remove bullet ${String(index + 1)}`}
              disabled={block.items.length <= 1}
              onClick={() => removeItem(index)}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="btn" disabled={block.items.length >= BULLET_ITEMS_MAX} onClick={addItem}>
        + Add bullet
      </button>
      <p className="field-hint">
        {block.items.length} / {BULLET_ITEMS_MAX} items, {BULLET_ITEM_TEXT_MAX} characters each
      </p>
    </div>
  );
}
