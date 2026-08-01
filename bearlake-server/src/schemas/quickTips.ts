import { z } from 'zod';

/** Request validation for quick tips. */

export const quickTipIdParamSchema = z.object({
  id: z.string().uuid('must be a valid id'),
});

export const createQuickTipSchema = z.strictObject({
  body: z.string().trim().min(1, 'is required').max(1000),
  // Optional: defaults to one past the current maximum (plan D19).
  sortOrder: z.number().int().optional(),
});

export const updateQuickTipSchema = z
  .strictObject({
    body: z.string().trim().min(1).max(1000).optional(),
    sortOrder: z.number().int().optional(),
  })
  .refine(
    (patch) => Object.values(patch).some((value) => value !== undefined),
    { message: 'Provide at least one field to change.' },
  );

export type CreateQuickTipInput = z.infer<typeof createQuickTipSchema>;
export type UpdateQuickTipInput = z.infer<typeof updateQuickTipSchema>;
