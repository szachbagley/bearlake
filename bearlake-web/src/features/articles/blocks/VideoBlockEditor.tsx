import { useState } from 'react';
import type { VideoBlock } from '../../../types/blocks.ts';
import { BLOCK_CAPTION_MAX } from '../../../types/limits.ts';
import { extractYouTubeId } from '../../../utils/youtube.ts';

/** Accepts a pasted YouTube URL or a bare id (plan W26); only the extracted
 * 11-character id is ever stored. Preview via youtube-nocookie.com. */
export function VideoBlockEditor({
  block,
  onChange,
}: {
  block: VideoBlock;
  onChange: (next: VideoBlock) => void;
}) {
  const [input, setInput] = useState(block.videoId);
  const [notRecognized, setNotRecognized] = useState(false);

  function handleInputChange(value: string): void {
    setInput(value);
    const id = extractYouTubeId(value);
    if (id === null) {
      setNotRecognized(value.trim().length > 0);
      return;
    }
    setNotRecognized(false);
    onChange({ ...block, videoId: id });
  }

  return (
    <div className="stack">
      <div className="field">
        <label htmlFor={`block-${block.id}-video`}>YouTube URL or video id</label>
        <input
          id={`block-${block.id}-video`}
          type="text"
          value={input}
          onChange={(e) => handleInputChange(e.target.value)}
        />
        {notRecognized && <p className="error">That doesn&rsquo;t look like a YouTube video.</p>}
      </div>
      <div className="field">
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
      {!notRecognized && (
        <iframe
          key={block.videoId}
          width="320"
          height="180"
          src={`https://www.youtube-nocookie.com/embed/${block.videoId}`}
          title="YouTube video preview"
          style={{ border: 0, borderRadius: 'var(--radius)' }}
          allowFullScreen
        />
      )}
    </div>
  );
}
