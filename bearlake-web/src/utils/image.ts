import type { AllowedUploadContentType } from '../types/limits.ts';

/**
 * In-browser image downscaling (plan W24, spec §4.5). Runs before every
 * upload so a 3–5 MB unmodified phone photo never reaches the presign step
 * at full size.
 */

const MAX_DIMENSION = 2000;
const JPEG_QUALITY = 0.85;

/** Pure dimension math, kept separate from the canvas I/O below so it's
 * testable without a real browser canvas. Never upscales — an image already
 * under the cap keeps its original size. */
export function computeDownscaleDimensions(
  width: number,
  height: number,
  maxDimension = MAX_DIMENSION,
): { width: number; height: number } {
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export interface DownscaledImage {
  blob: Blob;
  contentType: AllowedUploadContentType;
}

/**
 * Downscales to at most 2000px on the long edge and re-encodes as JPEG
 * q0.85. HEIC is the one exception (plan W24): `<canvas>` can't decode HEIC
 * in most browsers, so a HEIC file is uploaded as-is, unmodified.
 */
export async function downscaleImage(file: File): Promise<DownscaledImage> {
  if (file.type === 'image/heic') {
    return { blob: file, contentType: 'image/heic' };
  }

  const bitmap = await createImageBitmap(file);
  try {
    const { width, height } = computeDownscaleDimensions(bitmap.width, bitmap.height);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (ctx === null) {
      throw new Error('Canvas 2D context is not available.');
    }
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY);
    });
    if (blob === null) {
      throw new Error('Failed to encode the downscaled image.');
    }

    return { blob, contentType: 'image/jpeg' };
  } finally {
    bitmap.close();
  }
}
