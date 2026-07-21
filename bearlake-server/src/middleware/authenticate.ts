import type { NextFunction, Request, Response } from 'express';
import { findUserById } from '../db/queries/users.js';
import { verifyAccessToken } from '../services/tokenService.js';
import { AccountDisabledError, UnauthenticatedError } from '../types/errors.js';

/**
 * Bearer authentication (plan D5).
 *
 * The user row is loaded from MySQL on every request. Role, isActive, and
 * mustChangePassword are read from that row and never from the token, so a
 * deactivation or role change takes effect on the next request rather than
 * whenever the access token happens to expire. At this scale that is one
 * indexed primary-key lookup.
 */
export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.get('authorization');

  if (header === undefined || !header.startsWith('Bearer ')) {
    next(new UnauthenticatedError());
    return;
  }

  const token = header.slice('Bearer '.length).trim();
  if (token === '') {
    next(new UnauthenticatedError());
    return;
  }

  try {
    const userId = verifyAccessToken(token);
    const user = await findUserById(userId);

    if (user === null) {
      next(new UnauthenticatedError());
      return;
    }

    if (!user.isActive) {
      next(new AccountDisabledError());
      return;
    }

    req.user = user;
    res.locals.userId = user.id;
    next();
  } catch (err) {
    next(err);
  }
}
