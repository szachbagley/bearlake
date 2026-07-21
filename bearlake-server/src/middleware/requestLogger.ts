import type { NextFunction, Request, Response } from 'express';
import { logger } from '../lib/logger.js';

/**
 * Logs one line per request: method, path, status, duration, caller.
 *
 * Deliberately absent: request bodies, response bodies, query strings, and
 * headers. See the note in lib/logger.ts.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startedAt = process.hrtime.bigint();

  // Captured now, from originalUrl: Express rewrites req.url when a request
  // enters a mounted router, so req.path at finish-time would read /health for
  // a matched route and /api/v1/health for a 404. Splitting on '?' is what
  // keeps the query string out of the log.
  const path = req.originalUrl.split('?')[0] ?? req.originalUrl;

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    logger.info('request', {
      method: req.method,
      path,
      status: res.statusCode,
      durationMs: Math.round(durationMs),
      userId: res.locals.userId,
    });
  });

  next();
}
