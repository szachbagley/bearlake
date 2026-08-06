import { z } from 'zod';

/**
 * Request validation for upload presigning (plan D25).
 *
 * The content-type allowlist is enforced here (→ 400). The size cap is checked
 * in the service so it can return 413 rather than a generic validation error;
 * this schema only guarantees a positive integer byte count.
 */

export const ALLOWED_UPLOAD_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/heic'] as const;

/** 10 MB. Clients downscale before upload; nothing here needs more (spec §4.5). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const presignUploadSchema = z.strictObject({
  articleId: z.string().uuid('must be a valid article id'),
  contentType: z.enum(ALLOWED_UPLOAD_CONTENT_TYPES),
  contentLength: z.number().int().positive('must be a positive byte count'),
});

export type PresignUploadInput = z.infer<typeof presignUploadSchema>;
