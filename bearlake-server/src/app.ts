import cors from 'cors';
import express, { type Express, type Request, type Response } from 'express';
import { getConfig } from './config.js';
import { errorHandler } from './middleware/errorHandler.js';
import { requestLogger } from './middleware/requestLogger.js';
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

  app.use(API_BASE_PATH, api);

  app.use((_req: Request, _res: Response, next: express.NextFunction) => {
    next(new NotFoundError('That endpoint does not exist.'));
  });

  app.use(errorHandler);

  return app;
}
