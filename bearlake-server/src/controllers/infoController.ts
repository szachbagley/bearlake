import type { Request, Response } from 'express';
import {
  articleIdParamSchema,
  categoryIdParamSchema,
  createArticleSchema,
  createCategorySchema,
  updateArticleSchema,
  updateCategorySchema,
} from '../schemas/articles.js';
import * as infoService from '../services/infoService.js';
import { UnauthenticatedError } from '../types/errors.js';

/**
 * Knowledge base. Reads are open to any member; writes are behind requireAdmin
 * on the router. Draft gating is decided in the service from the caller's role.
 */

function caller(req: Request) {
  if (req.user === undefined) {
    throw new UnauthenticatedError();
  }
  return req.user;
}

// ── Categories ──────────────────────────────────────────────────────────────

export async function listCategories(_req: Request, res: Response): Promise<void> {
  res.json({ categories: await infoService.listAllCategories() });
}

export async function createCategory(req: Request, res: Response): Promise<void> {
  const input = createCategorySchema.parse(req.body);
  res.status(201).json(await infoService.createCategory(input.title, input.sortOrder));
}

export async function updateCategory(req: Request, res: Response): Promise<void> {
  const { id } = categoryIdParamSchema.parse(req.params);
  const input = updateCategorySchema.parse(req.body);
  res.json(await infoService.updateExistingCategory(id, input));
}

export async function removeCategory(req: Request, res: Response): Promise<void> {
  const { id } = categoryIdParamSchema.parse(req.params);
  await infoService.removeCategory(id);
  res.status(204).send();
}

export async function listArticles(req: Request, res: Response): Promise<void> {
  const { id } = categoryIdParamSchema.parse(req.params);
  res.json({ articles: await infoService.listArticles(id, caller(req)) });
}

// ── Articles ────────────────────────────────────────────────────────────────

export async function getArticle(req: Request, res: Response): Promise<void> {
  const { id } = articleIdParamSchema.parse(req.params);
  res.json(await infoService.getArticle(id, caller(req)));
}

export async function createArticle(req: Request, res: Response): Promise<void> {
  const input = createArticleSchema.parse(req.body);
  res.status(201).json(await infoService.createArticle(input, caller(req).id));
}

export async function updateArticle(req: Request, res: Response): Promise<void> {
  const { id } = articleIdParamSchema.parse(req.params);
  const input = updateArticleSchema.parse(req.body);
  res.json(await infoService.updateArticle(id, input));
}

export async function removeArticle(req: Request, res: Response): Promise<void> {
  const { id } = articleIdParamSchema.parse(req.params);
  await infoService.removeArticle(id);
  res.status(204).send();
}
