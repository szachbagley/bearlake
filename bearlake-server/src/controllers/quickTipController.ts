import type { Request, Response } from 'express';
import {
  createQuickTipSchema,
  quickTipIdParamSchema,
  updateQuickTipSchema,
} from '../schemas/quickTips.js';
import * as quickTipService from '../services/quickTipService.js';
import { UnauthenticatedError } from '../types/errors.js';

/**
 * Quick tips. Reads are open to any member; writes are behind requireAdmin on
 * the router. Bodies carry gate codes and key locations and are never logged.
 */

export async function list(_req: Request, res: Response): Promise<void> {
  res.json({ quickTips: await quickTipService.list() });
}

export async function create(req: Request, res: Response): Promise<void> {
  if (req.user === undefined) {
    throw new UnauthenticatedError();
  }
  const input = createQuickTipSchema.parse(req.body);
  res.status(201).json(await quickTipService.create(input.body, input.sortOrder, req.user.id));
}

export async function update(req: Request, res: Response): Promise<void> {
  const { id } = quickTipIdParamSchema.parse(req.params);
  const patch = updateQuickTipSchema.parse(req.body);
  res.json(await quickTipService.update(id, patch));
}

export async function remove(req: Request, res: Response): Promise<void> {
  const { id } = quickTipIdParamSchema.parse(req.params);
  await quickTipService.remove(id);
  res.status(204).send();
}
