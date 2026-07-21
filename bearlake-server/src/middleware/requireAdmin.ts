import type { NextFunction, Request, Response } from 'express';
import { ForbiddenError, UnauthenticatedError } from '../types/errors.js';

/**
 * Admin-only guard.
 *
 * Hiding a control in a client is a UI affordance; this is the authorization.
 * Every admin-only route carries it independently of what any client shows.
 */
export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (req.user === undefined) {
    next(new UnauthenticatedError());
    return;
  }

  if (req.user.role !== 'admin') {
    next(new ForbiddenError());
    return;
  }

  next();
}
