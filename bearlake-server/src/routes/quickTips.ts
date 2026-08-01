import { Router } from 'express';
import * as quickTipController from '../controllers/quickTipController.js';
import { requireAdmin } from '../middleware/requireAdmin.js';

/**
 * Quick-tip routes. Authentication and the password-change gate are applied
 * where this router is mounted. Reading is open to any member; each write route
 * carries requireAdmin individually.
 */
export function createQuickTipsRouter(): Router {
  const router = Router();

  router.get('/', quickTipController.list);
  router.post('/', requireAdmin, quickTipController.create);
  router.patch('/:id', requireAdmin, quickTipController.update);
  router.delete('/:id', requireAdmin, quickTipController.remove);

  return router;
}
