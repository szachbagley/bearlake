import type { Request, Response } from 'express';
import { presignUploadSchema } from '../schemas/uploads.js';
import * as uploadService from '../services/uploadService.js';

/**
 * Upload presigning. Admin-only (guarded on the router). Returns the object key
 * to store in the image block and a short-lived presigned PUT URL.
 */
export async function presign(req: Request, res: Response): Promise<void> {
  const input = presignUploadSchema.parse(req.body);
  res.json(await uploadService.createPresignedUpload(input));
}
