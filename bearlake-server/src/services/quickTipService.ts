import {
  deleteQuickTip,
  findQuickTipById,
  insertQuickTip,
  listQuickTips,
  nextQuickTipSortOrder,
  type QuickTipUpdate,
  updateQuickTip,
} from '../db/queries/quickTips.js';
import type { QuickTip } from '../types/domain.js';
import { InternalError, NotFoundError } from '../types/errors.js';

/**
 * Quick-tip business logic. Reads are open to any member; writes are
 * admin-only, enforced by middleware on the routes.
 */

export async function list(): Promise<QuickTip[]> {
  return listQuickTips();
}

/** Appends by default: an unspecified sort order lands past the current last. */
export async function create(
  body: string,
  sortOrder: number | undefined,
  createdBy: string,
): Promise<QuickTip> {
  const order = sortOrder ?? (await nextQuickTipSortOrder());
  return insertQuickTip(body, order, createdBy);
}

export async function update(id: string, patch: QuickTipUpdate): Promise<QuickTip> {
  const existing = await findQuickTipById(id);
  if (existing === null) {
    throw new NotFoundError('That quick tip could not be found.');
  }
  const updated = await updateQuickTip(id, patch);
  if (updated === null) {
    throw new InternalError();
  }
  return updated;
}

export async function remove(id: string): Promise<void> {
  const deleted = await deleteQuickTip(id);
  if (!deleted) {
    throw new NotFoundError('That quick tip could not be found.');
  }
}
