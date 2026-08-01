import { Router } from 'express';
import * as announcementController from '../controllers/announcementController.js';
import { requireAdmin } from '../middleware/requireAdmin.js';

/**
 * Announcement routes. Authentication and the password-change gate are applied
 * where this router is mounted. Reading is open to any member; each write route
 * carries requireAdmin individually, so a route added later cannot inherit
 * write access by accident.
 */
export function createAnnouncementsRouter(): Router {
  const router = Router();

  router.get('/', announcementController.list);
  router.post('/', requireAdmin, announcementController.create);
  router.patch('/:id', requireAdmin, announcementController.update);
  router.delete('/:id', requireAdmin, announcementController.remove);

  return router;
}
