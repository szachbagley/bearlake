import { Router } from 'express';
import * as authController from '../controllers/authController.js';
import { authenticate } from '../middleware/authenticate.js';
import { enforceLoginRateLimit } from '../middleware/rateLimit.js';

/**
 * Auth routes.
 *
 * There is deliberately no `POST /auth/register`. Accounts are created by an
 * admin through `POST /users`; any route here that could mint a user without
 * an authenticated admin would be a bug.
 *
 * `refresh` and `logout` authenticate with the refresh token in the body, not
 * a bearer token, so they work while the access token is expired.
 *
 * `change-password` requires a bearer token but is exempt from the
 * password-change gate — it is the way out of that state.
 */
export function createAuthRouter(): Router {
  const router = Router();

  router.post('/login', enforceLoginRateLimit, authController.login);
  router.post('/refresh', authController.refresh);
  router.post('/logout', authController.logout);
  router.post('/change-password', authenticate, authController.changePassword);

  return router;
}
