import { z } from 'zod';
import { emailSchema } from './auth.js';

/**
 * Request validation for user administration.
 *
 * No password field anywhere: passwords are generated server-side on creation
 * and reset, and changed only by their owner. An admin never chooses or sees a
 * password except the one-time temporary value the server returns.
 *
 * Bodies are strict (plan D38): an unknown key is a 400 rather than being
 * silently dropped. A client that sends `mustChangePassword: false` or
 * `passwordHash` should be told the field does not exist, not left believing
 * the request did something it did not.
 */

export const userIdParamSchema = z.object({
  id: z.string().uuid('must be a valid id'),
});

export const createUserSchema = z.strictObject({
  displayName: z.string().trim().min(1, 'is required').max(100),
  email: emailSchema,
  role: z.enum(['admin', 'member']),
});

export const updateUserSchema = z
  .strictObject({
    displayName: z.string().trim().min(1).max(100).optional(),
    role: z.enum(['admin', 'member']).optional(),
    isActive: z.boolean().optional(),
  })
  .refine(
    (update) => Object.values(update).some((value) => value !== undefined),
    { message: 'Provide at least one field to change.' },
  );

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
