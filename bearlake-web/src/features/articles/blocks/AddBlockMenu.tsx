import { useRef } from 'react';
import { ALLOWED_UPLOAD_CONTENT_TYPES } from '../../../types/limits.ts';
import type { KnownBlockType } from '../../../types/blocks.ts';

/**
 * Appends a block (plan step 3). Photo goes through a hidden file input
 * instead of `onAdd`, since choosing a photo starts the upload pipeline
 * rather than appending a block outright — the block only exists once the
 * upload succeeds.
 */
export function AddBlockMenu({
  onAdd,
  onPickPhoto,
  disabled = false,
}: {
  onAdd: (type: Exclude<KnownBlockType, 'image'>) => void;
  onPickPhoto: (file: File) => void;
  disabled?: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="row">
      <button type="button" className="btn" disabled={disabled} onClick={() => onAdd('heading')}>
        + Heading
      </button>
      <button type="button" className="btn" disabled={disabled} onClick={() => onAdd('paragraph')}>
        + Paragraph
      </button>
      <button type="button" className="btn" disabled={disabled} onClick={() => onAdd('bullets')}>
        + Bullet list
      </button>
      <button
        type="button"
        className="btn"
        disabled={disabled}
        onClick={() => fileInputRef.current?.click()}
      >
        + Photo
      </button>
      <button type="button" className="btn" disabled={disabled} onClick={() => onAdd('video')}>
        + Video
      </button>
      {/* The "+ Photo" button above is the real control; this input is only
       * the mechanism it drives. Labelled so it is not an anonymous control
       * in the a11y tree, and taken out of the tab order so keyboard users
       * get one stop for "add a photo", not two. */}
      <input
        ref={fileInputRef}
        type="file"
        aria-label="Choose a photo to upload"
        tabIndex={-1}
        accept={ALLOWED_UPLOAD_CONTENT_TYPES.join(',')}
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file !== undefined) onPickPhoto(file);
        }}
      />
    </div>
  );
}
