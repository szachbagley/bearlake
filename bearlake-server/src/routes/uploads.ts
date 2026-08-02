import { Router } from 'express';
import * as uploadController from '../controllers/uploadController.js';
import { requireAdmin } from '../middleware/requireAdmin.js';

/**
 * Upload routes. Authentication and the password-change gate are applied where
 * this router is mounted; presigning is admin-only, since only admins author
 * knowledge-base content.
 */
export function createUploadsRouter(): Router {
  const router = Router();

  router.post('/presign', requireAdmin, uploadController.presign);

  return router;
}
