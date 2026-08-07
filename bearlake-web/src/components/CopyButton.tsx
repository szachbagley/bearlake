import { useState } from 'react';

const CONFIRMATION_MS = 2000;

/**
 * Copies `value` to the clipboard on click (plan step 3) — used for temp
 * passwords (Phase 5, W31) and the article-conflict "copy my changes" dump
 * (W16). Never logs `value`: a caught clipboard failure surfaces only a
 * generic message, never the value itself or the raw error.
 */
export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function handleClick(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setState('copied');
    } catch {
      setState('failed');
    }
    setTimeout(() => setState('idle'), CONFIRMATION_MS);
  }

  return (
    <button type="button" className="btn" onClick={() => void handleClick()}>
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : label}
    </button>
  );
}
