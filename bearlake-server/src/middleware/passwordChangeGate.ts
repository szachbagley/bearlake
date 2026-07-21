import type { NextFunction, Request, Response } from 'express';
import { PasswordChangeRequiredError, UnauthenticatedError } from '../types/errors.js';

/**
 * Blocks a user who must change their password from reaching anything else
 * (plan D8).
 *
 * Mounted once in app.ts, after the two exempt routes (`GET /me` and
 * `POST /auth/change-password`) and before every other authenticated route, so
 * a new resource is gated by default rather than by remembering to add it.
 *
 * `/auth/refresh` and `/auth/logout` authenticate with a refresh token rather
 * than a bearer token and never reach this middleware — deliberately, so a
 * user in this state can still renew an expired access token and complete the
 * change.
 */
export function passwordChangeGate(req: Request, _res: Response, next: NextFunction): void {
  if (req.user === undefined) {
    next(new UnauthenticatedError());
    return;
  }

  if (req.user.mustChangePassword) {
    next(new PasswordChangeRequiredError());
    return;
  }

  next();
}
