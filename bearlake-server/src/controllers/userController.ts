import type { Request, Response } from 'express';
import { createUserSchema, updateUserSchema, userIdParamSchema } from '../schemas/users.js';
import * as userService from '../services/userService.js';
import { UnauthenticatedError } from '../types/errors.js';

/**
 * Admin user administration. Every route here is behind requireAdmin.
 *
 * Two of these responses carry a plaintext temporary password. Nothing in this
 * file logs, and the request logger never records bodies, so those values
 * exist only in the response itself.
 */

function callerId(req: Request): string {
  if (req.user === undefined) {
    throw new UnauthenticatedError();
  }
  return req.user.id;
}

export async function list(_req: Request, res: Response): Promise<void> {
  res.json({ users: await userService.list() });
}

export async function create(req: Request, res: Response): Promise<void> {
  const input = createUserSchema.parse(req.body);
  const created = await userService.create(input);

  res.status(201).json(created);
}

export async function update(req: Request, res: Response): Promise<void> {
  const { id } = userIdParamSchema.parse(req.params);
  const input = updateUserSchema.parse(req.body);

  res.json(await userService.update(callerId(req), id, input));
}

export async function resetPassword(req: Request, res: Response): Promise<void> {
  const { id } = userIdParamSchema.parse(req.params);

  res.json(await userService.resetPassword(id));
}
