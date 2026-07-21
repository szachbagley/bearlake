import type { Request, Response } from 'express';
import {
  normalizeEmail,
  recordLoginFailure,
  recordLoginSuccess,
} from '../middleware/rateLimit.js';
import * as authService from '../services/authService.js';
import { toPublicUser } from '../services/userSerializer.js';
import {
  changePasswordSchema,
  loginSchema,
  logoutSchema,
  refreshSchema,
} from '../schemas/auth.js';
import { UnauthenticatedError } from '../types/errors.js';

/**
 * Thin handlers: validate, delegate, shape the response.
 *
 * Express 5 forwards a rejected promise to the error middleware on its own, so
 * these do not wrap themselves in try/catch.
 */

export async function login(req: Request, res: Response): Promise<void> {
  const ip = req.ip ?? 'unknown';
  // Read before validation so a malformed body still counts against the limit.
  const attemptedEmail = normalizeEmail((req.body as { email?: unknown }).email);

  let input;
  try {
    input = loginSchema.parse(req.body);
  } catch (err) {
    recordLoginFailure(attemptedEmail, ip);
    throw err;
  }

  try {
    const session = await authService.login(input.email, input.password);
    recordLoginSuccess(input.email, ip);
    res.json(session);
  } catch (err) {
    recordLoginFailure(input.email, ip);
    throw err;
  }
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const input = refreshSchema.parse(req.body);
  res.json(await authService.refresh(input.refreshToken));
}

export async function logout(req: Request, res: Response): Promise<void> {
  const input = logoutSchema.parse(req.body);
  await authService.logout(input.refreshToken);
  res.status(204).send();
}

export async function changePassword(req: Request, res: Response): Promise<void> {
  if (req.user === undefined) {
    throw new UnauthenticatedError();
  }

  const input = changePasswordSchema.parse(req.body);
  res.json(
    await authService.changePassword(req.user.id, input.currentPassword, input.newPassword),
  );
}

export function me(req: Request, res: Response): void {
  if (req.user === undefined) {
    throw new UnauthenticatedError();
  }
  res.json(toPublicUser(req.user));
}
