import { Router } from 'express';
import * as userController from '../controllers/userController.js';
import { requireAdmin } from '../middleware/requireAdmin.js';

/**
 * User administration — admin only, and the only surface for it. The iOS app
 * has no user management at all; this exists for the web admin app.
 *
 * Authentication and the password-change gate are applied where this router is
 * mounted. `requireAdmin` is applied to every route here rather than to the
 * router, so a route added later cannot inherit access by accident.
 */
export function createUsersRouter(): Router {
  const router = Router();

  router.get('/', requireAdmin, userController.list);
  router.post('/', requireAdmin, userController.create);
  router.patch('/:id', requireAdmin, userController.update);
  router.post('/:id/reset-password', requireAdmin, userController.resetPassword);

  return router;
}
