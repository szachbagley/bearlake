/**
 * Express augmentations.
 *
 * `res.locals.userId` is set by the authentication middleware (Phase 2) and
 * read by the request logger. It is the only per-request identity the logger
 * ever sees.
 */

declare global {
  namespace Express {
    interface Locals {
      userId?: string;
    }
  }
}

export {};
