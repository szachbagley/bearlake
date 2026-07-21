/**
 * Domain shapes as the application sees them: camelCase, booleans as booleans,
 * timestamps as ISO-8601 UTC strings. Query modules convert database rows into
 * these at the edge, so nothing above db/ handles a raw row.
 */

export type UserRole = 'admin' | 'member';

export interface User {
  id: string;
  displayName: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  mustChangePassword: boolean;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewUser {
  displayName: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  mustChangePassword: boolean;
  isActive: boolean;
}

export interface RefreshToken {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
}

export interface NewRefreshToken {
  userId: string;
  tokenHash: string;
  expiresAt: string;
}
