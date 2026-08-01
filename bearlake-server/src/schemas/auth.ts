import { z } from 'zod';

/**
 * Request validation for the auth routes.
 *
 * Password fields are deliberately unconstrained here beyond being non-empty:
 * the policy lives in passwordService so that one place decides what is
 * acceptable, and so a login attempt with a short password fails as bad
 * credentials rather than as a validation error that reveals the rules.
 */

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'is required')
  .max(255)
  .email('must be a valid email address');

export const loginSchema = z.strictObject({
  email: emailSchema,
  password: z.string().min(1, 'is required'),
});

export const refreshSchema = z.strictObject({
  refreshToken: z.string().min(1, 'is required'),
});

export const logoutSchema = refreshSchema;

export const changePasswordSchema = z.strictObject({
  currentPassword: z.string().min(1, 'is required'),
  newPassword: z.string().min(1, 'is required'),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
