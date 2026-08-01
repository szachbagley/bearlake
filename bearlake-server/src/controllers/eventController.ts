import type { Request, Response } from 'express';
import {
  eventBodySchema,
  eventIdParamSchema,
  eventRangeQuerySchema,
  patchEventSchema,
} from '../schemas/events.js';
import * as eventService from '../services/eventService.js';
import { UnauthenticatedError } from '../types/errors.js';

/**
 * Events. All routes are authenticated; creation and reading are open to any
 * member, while the service enforces creator-or-admin on modify and delete.
 */

function caller(req: Request) {
  if (req.user === undefined) {
    throw new UnauthenticatedError();
  }
  return req.user;
}

export async function list(req: Request, res: Response): Promise<void> {
  const { start, end } = eventRangeQuerySchema.parse(req.query);
  res.json({ events: await eventService.listInRange(start, end) });
}

export async function create(req: Request, res: Response): Promise<void> {
  const body = eventBodySchema.parse(req.body);
  res.status(201).json(await eventService.create(body, caller(req).id));
}

export async function get(req: Request, res: Response): Promise<void> {
  const { id } = eventIdParamSchema.parse(req.params);
  res.json(await eventService.get(id));
}

export async function update(req: Request, res: Response): Promise<void> {
  const { id } = eventIdParamSchema.parse(req.params);
  const patch = patchEventSchema.parse(req.body);
  res.json(await eventService.update(id, patch, caller(req)));
}

export async function remove(req: Request, res: Response): Promise<void> {
  const { id } = eventIdParamSchema.parse(req.params);
  await eventService.remove(id, caller(req));
  res.status(204).send();
}
