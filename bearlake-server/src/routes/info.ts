import { Router } from 'express';
import * as infoController from '../controllers/infoController.js';
import { requireAdmin } from '../middleware/requireAdmin.js';

/**
 * Knowledge-base routes. Authentication and the password-change gate are
 * applied where this router is mounted. Reads are open to any member; every
 * write route carries requireAdmin individually.
 *
 * Route order matters: the literal `/articles` and `/categories` segments are
 * registered so `/categories/:id/articles` resolves correctly.
 */
export function createInfoRouter(): Router {
  const router = Router();

  router.get('/categories', infoController.listCategories);
  router.post('/categories', requireAdmin, infoController.createCategory);
  router.patch('/categories/:id', requireAdmin, infoController.updateCategory);
  router.delete('/categories/:id', requireAdmin, infoController.removeCategory);
  router.get('/categories/:id/articles', infoController.listArticles);

  router.get('/articles/:id', infoController.getArticle);
  router.post('/articles', requireAdmin, infoController.createArticle);
  router.patch('/articles/:id', requireAdmin, infoController.updateArticle);
  router.delete('/articles/:id', requireAdmin, infoController.removeArticle);

  return router;
}
