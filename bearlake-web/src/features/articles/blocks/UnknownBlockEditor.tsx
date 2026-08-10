import type { UnknownBlock } from '../../../types/blocks.ts';

/** Read-only, round-trips unchanged on save (plan W23). This build doesn't
 * know how to render or edit this block's type — dropping it would be an
 * unrecoverable content loss, so it's preserved and shown as-is instead. */
export function UnknownBlockEditor({ block }: { block: UnknownBlock }) {
  return (
    <div className="stack">
      <p className="text-muted">Unsupported block — preserved on save.</p>
      <pre style={{ overflowX: 'auto', fontSize: '0.8125rem' }}>{JSON.stringify(block, null, 2)}</pre>
    </div>
  );
}
