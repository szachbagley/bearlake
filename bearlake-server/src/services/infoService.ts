import {
  countArticlesInCategory,
  type CategoryUpdate,
  deleteCategory,
  findCategoryById,
  insertCategory,
  listCategories,
  nextCategorySortOrder,
  updateCategory,
} from '../db/queries/infoCategories.js';
import {
  deleteArticle,
  findArticleById,
  insertArticle,
  listArticlesByCategory,
  nextArticleSortOrder,
  updateArticleIfCurrent,
} from '../db/queries/infoArticles.js';
import type {
  ApiBlock,
  ArticleSummary,
  ArticleWrite,
  InfoArticle,
  InfoCategory,
  User,
} from '../types/domain.js';
import {
  CategoryNotEmptyError,
  InternalError,
  NotFoundError,
  StaleArticleError,
  ValidationError,
} from '../types/errors.js';
import type { CreateArticleInput, UpdateArticleInput } from '../schemas/articles.js';
import { withImageUrls } from './imageUrlService.js';

/**
 * Knowledge-base business logic.
 *
 * Reads are open to any member, but drafts are gated by role: a member sees
 * only published articles, and requesting a draft directly is a 404 — not a
 * 403, which would confirm the draft exists (spec §4.4).
 */

// ── Categories ──────────────────────────────────────────────────────────────

export async function listAllCategories(): Promise<InfoCategory[]> {
  return listCategories();
}

export async function createCategory(
  title: string,
  sortOrder: number | undefined,
): Promise<InfoCategory> {
  const order = sortOrder ?? (await nextCategorySortOrder());
  return insertCategory(title, order);
}

export async function updateExistingCategory(
  id: string,
  update: CategoryUpdate,
): Promise<InfoCategory> {
  const existing = await findCategoryById(id);
  if (existing === null) {
    throw new NotFoundError('That category could not be found.');
  }
  const updated = await updateCategory(id, update);
  if (updated === null) {
    throw new InternalError();
  }
  return updated;
}

/** Refuses to delete a category that still holds articles (plan D2). */
export async function removeCategory(id: string): Promise<void> {
  const existing = await findCategoryById(id);
  if (existing === null) {
    throw new NotFoundError('That category could not be found.');
  }
  if ((await countArticlesInCategory(id)) > 0) {
    throw new CategoryNotEmptyError();
  }
  await deleteCategory(id);
}

// ── Articles ────────────────────────────────────────────────────────────────

export async function listArticles(
  categoryId: string,
  caller: User,
): Promise<ArticleSummary[]> {
  const category = await findCategoryById(categoryId);
  if (category === null) {
    throw new NotFoundError('That category could not be found.');
  }
  return listArticlesByCategory(categoryId, caller.role === 'admin');
}

/** The article response: blocks with image URLs resolved (plan D24). */
export interface ArticleResponse extends Omit<InfoArticle, 'blocks'> {
  blocks: ApiBlock[];
}

async function toResponse(article: InfoArticle): Promise<ArticleResponse> {
  return { ...article, blocks: await withImageUrls(article.blocks) };
}

export async function getArticle(id: string, caller: User): Promise<ArticleResponse> {
  const article = await findArticleById(id);

  // A member requesting a draft gets 404, identical to a nonexistent article,
  // so the response never confirms a draft exists.
  if (article === null || (article.status === 'draft' && caller.role !== 'admin')) {
    throw new NotFoundError('That article could not be found.');
  }

  return toResponse(article);
}

export async function createArticle(
  input: CreateArticleInput,
  createdBy: string,
): Promise<ArticleResponse> {
  const category = await findCategoryById(input.categoryId);
  if (category === null) {
    throw new ValidationError('That category does not exist.');
  }

  const write: ArticleWrite = {
    categoryId: input.categoryId,
    title: input.title,
    blocks: input.blocks,
    status: input.status,
    sortOrder: input.sortOrder ?? (await nextArticleSortOrder(input.categoryId)),
  };

  return toResponse(await insertArticle(write, createdBy));
}

/**
 * Applies a patch under optimistic concurrency (plan D23).
 *
 * The provided `updatedAt` must still match the stored row; a mismatch is a
 * 409 offering the client the chance to reload rather than clobbering a
 * concurrent edit. The merge is over the stored article so an omitted field
 * keeps its value.
 */
export async function updateArticle(
  id: string,
  input: UpdateArticleInput,
): Promise<ArticleResponse> {
  const existing = await findArticleById(id);
  if (existing === null) {
    throw new NotFoundError('That article could not be found.');
  }

  if (input.categoryId !== undefined && input.categoryId !== existing.categoryId) {
    const category = await findCategoryById(input.categoryId);
    if (category === null) {
      throw new ValidationError('That category does not exist.');
    }
  }

  // Fast rejection on a version we can already see is stale; the DB guard below
  // closes the window between this read and the write.
  if (existing.updatedAt !== input.updatedAt) {
    throw new StaleArticleError();
  }

  const write: ArticleWrite = {
    categoryId: input.categoryId ?? existing.categoryId,
    title: input.title ?? existing.title,
    blocks: input.blocks ?? existing.blocks,
    status: input.status ?? existing.status,
    sortOrder: input.sortOrder ?? existing.sortOrder,
  };

  const result = await updateArticleIfCurrent(id, input.updatedAt, write);
  if (result.outcome === 'stale' || result.article === null) {
    throw new StaleArticleError();
  }

  return toResponse(result.article);
}

export async function removeArticle(id: string): Promise<void> {
  const deleted = await deleteArticle(id);
  if (!deleted) {
    throw new NotFoundError('That article could not be found.');
  }
}
