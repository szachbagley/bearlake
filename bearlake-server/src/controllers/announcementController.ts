import type { Request, Response } from 'express';
import {
  announcementIdParamSchema,
  createAnnouncementSchema,
  listAnnouncementsQuerySchema,
  updateAnnouncementSchema,
} from '../schemas/announcements.js';
import * as announcementService from '../services/announcementService.js';
import { UnauthenticatedError } from '../types/errors.js';

/**
 * Announcements. Reads are open to any member; writes are behind requireAdmin
 * on the router. Bodies carry gate codes and passcodes and are never logged.
 */

export async function list(req: Request, res: Response): Promise<void> {
  const { limit, cursor } = listAnnouncementsQuerySchema.parse(req.query);
  res.json(await announcementService.list(limit, cursor));
}

export async function create(req: Request, res: Response): Promise<void> {
  if (req.user === undefined) {
    throw new UnauthenticatedError();
  }
  const { body } = createAnnouncementSchema.parse(req.body);
  res.status(201).json(await announcementService.create(body, req.user.id));
}

export async function update(req: Request, res: Response): Promise<void> {
  const { id } = announcementIdParamSchema.parse(req.params);
  const { body } = updateAnnouncementSchema.parse(req.body);
  res.json(await announcementService.update(id, body));
}

export async function remove(req: Request, res: Response): Promise<void> {
  const { id } = announcementIdParamSchema.parse(req.params);
  await announcementService.remove(id);
  res.status(204).send();
}
