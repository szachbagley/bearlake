import { findArticleById } from '../db/queries/infoArticles.js';
import { MAX_UPLOAD_BYTES } from '../schemas/uploads.js';
import { NotFoundError, PayloadTooLargeError } from '../types/errors.js';
import { generateImageKey, presignPut } from './s3Service.js';

/**
 * Upload presigning (plan D25).
 *
 * The article must already exist — the editor creates the draft before its
 * first image upload — so the key can be namespaced under it and an upload for
 * a bogus article is refused up front. The content-type allowlist is enforced
 * by the schema; the size cap is here so an oversize request is 413 rather than
 * a generic 400.
 */

export interface PresignedUpload {
  key: string;
  uploadUrl: string;
}

export async function createPresignedUpload(input: {
  articleId: string;
  contentType: string;
  contentLength: number;
}): Promise<PresignedUpload> {
  if (input.contentLength > MAX_UPLOAD_BYTES) {
    throw new PayloadTooLargeError('That image is larger than the 10 MB limit.');
  }

  const article = await findArticleById(input.articleId);
  if (article === null) {
    throw new NotFoundError('That article could not be found.');
  }

  const key = generateImageKey(input.articleId);
  const uploadUrl = await presignPut({
    key,
    contentType: input.contentType,
    contentLength: input.contentLength,
  });

  return { key, uploadUrl };
}
