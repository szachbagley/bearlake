import type { User, UserRole } from '../types/domain.js';

/**
 * The user shape clients receive.
 *
 * An explicit allowlist, not an omission of `passwordHash` — spreading a row
 * and deleting fields is how a hash eventually ends up in a response after
 * someone adds a column.
 */
export interface PublicUser {
  id: string;
  displayName: string;
  email: string;
  role: UserRole;
  mustChangePassword: boolean;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    displayName: user.displayName,
    email: user.email,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
