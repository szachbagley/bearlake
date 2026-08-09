import type { ApiClient } from '../../api/context.tsx';
import { ALLOWED_UPLOAD_CONTENT_TYPES, MAX_UPLOAD_BYTES } from '../../types/limits.ts';
import { downscaleImage } from '../../utils/image.ts';

/** Thrown for a rejection that happens before any network call — the
 * allowlist/size checks the plan requires to run "before any presign call". */
export class UploadRejectedError extends Error {}

function isAllowedContentType(type: string): type is (typeof ALLOWED_UPLOAD_CONTENT_TYPES)[number] {
  return (ALLOWED_UPLOAD_CONTENT_TYPES as readonly string[]).includes(type);
}

/**
 * The full pipeline (plan W24, step 5): validate → downscale → presign →
 * PUT to S3 with the exact post-downscale `Content-Length` → return the
 * stored key. `onProgress` reports the S3 PUT's upload progress (0–100);
 * downscaling itself has no meaningful progress to report.
 */
export async function uploadImage(
  api: ApiClient,
  articleId: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<string> {
  if (!isAllowedContentType(file.type)) {
    throw new UploadRejectedError(`"${file.type || 'unknown'}" isn't a supported image type.`);
  }

  const { blob, contentType } = await downscaleImage(file);

  if (blob.size > MAX_UPLOAD_BYTES) {
    throw new UploadRejectedError('That image is larger than the 10 MB limit.');
  }

  const { key, uploadUrl } = await api.presignUpload({
    articleId,
    contentType,
    contentLength: blob.size,
  });

  await putToS3(uploadUrl, blob, contentType, onProgress);

  return key;
}

/**
 * A raw PUT of the exact bytes presigned, with the exact `Content-Type`
 * signed (plan D25) — XMLHttpRequest, not `fetch`, so real upload progress
 * is available for the block editor to show.
 */
function putToS3(
  uploadUrl: string,
  blob: Blob,
  contentType: string,
  onProgress?: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Image upload failed (status ${String(xhr.status)}).`));
      }
    };
    xhr.onerror = () => {
      reject(new Error('Image upload failed.'));
    };
    xhr.send(blob);
  });
}
