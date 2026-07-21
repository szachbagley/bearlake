import cors from 'cors';
import express, { type Express, type Request, type Response } from 'express';
import { getConfig } from './config.js';
import * as authController from './controllers/authController.js';
import { authenticate } from './middleware/authenticate.js';
import { errorHandler } from './middleware/errorHandler.js';
import { passwordChangeGate } from './middleware/passwordChangeGate.js';
import { requestLogger } from './middleware/requestLogger.js';
import { createAuthRouter } from './routes/auth.js';
import { createUsersRouter } from './routes/users.js';
import { NotFoundError } from './types/errors.js';

export const API_BASE_PATH = '/api/v1';

/**
 * Assembles the Express app without binding a port, so the test suite can
 * drive it through supertest exactly as a client would.
 */
export function createApp(): Express {
  const config = getConfig();
  const app = express();

  app.disable('x-powered-by');

  // Railway terminates TLS and forwards one hop. Without this, req.ip is the
  // proxy's address and the whole family shares a single rate-limit bucket.
  // Trusting exactly one hop stops a client spoofing X-Forwarded-For to dodge
  // the limit, which trusting the full chain would allow.
  app.set('trust proxy', config.isProduction ? 1 : false);

  app.use(
    cors({
      origin(origin, callback) {
        // No Origin header: curl, the iOS client, server-to-server. CORS does
        // not apply to these, and rejecting them here would do nothing useful.
        if (origin === undefined || config.webOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(null, false);
      },
    }),
  );

  app.use(requestLogger);
  app.use(express.json({ limit: '1mb' }));

  const api = express.Router();

  api.get('/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  // Public, plus change-password which authenticates but is gate-exempt.
  api.use('/auth', createAuthRouter());

  // Authenticated and gate-exempt: a user who must change their password can
  // still ask who they are.
  api.get('/me', authenticate, authController.me);

  // ─────────────────────────────────────────────────────────────────────────
  // Everything below is authenticated AND subject to the password-change gate
  // (plan D8). Mounting the gate once here means a route added later is gated
  // by default; a route that needs to be exempt has to be placed above this
  // line deliberately, which is the safe direction for the mistake to run.
  // ─────────────────────────────────────────────────────────────────────────
  api.use(authenticate, passwordChangeGate);

  api.use('/users', createUsersRouter());

  // Phases 4–7 mount their routers here.

  app.use(API_BASE_PATH, api);

  app.use((_req: Request, _res: Response, next: express.NextFunction) => {
    next(new NotFoundError('That endpoint does not exist.'));
  });

  app.use(errorHandler);

  return app;
}
