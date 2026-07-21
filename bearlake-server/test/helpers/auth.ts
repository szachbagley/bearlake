import request from 'supertest';
import { insertUser } from '../../src/db/queries/users.js';
import { hashPassword } from '../../src/services/passwordService.js';
import type { User, UserRole } from '../../src/types/domain.js';
import { testApp } from './app.js';

/**
 * Account and session fixtures.
 *
 * Sessions are obtained by actually calling POST /auth/login rather than by
 * minting tokens directly, so every test exercises the real path a client
 * takes.
 */

export const DEFAULT_PASSWORD = 'correct-battery-staple-2026';

export interface TestUserOptions {
  email?: string;
  displayName?: string;
  role?: UserRole;
  password?: string;
  mustChangePassword?: boolean;
  isActive?: boolean;
}

export interface TestUser {
  user: User;
  password: string;
}

let sequence = 0;

export async function createTestUser(options: TestUserOptions = {}): Promise<TestUser> {
  sequence += 1;
  const password = options.password ?? DEFAULT_PASSWORD;

  const user = await insertUser({
    displayName: options.displayName ?? `Test User ${String(sequence)}`,
    email: options.email ?? `user${String(sequence)}@example.com`,
    passwordHash: await hashPassword(password),
    role: options.role ?? 'member',
    mustChangePassword: options.mustChangePassword ?? false,
    isActive: options.isActive ?? true,
  });

  return { user, password };
}

export interface Session {
  user: User;
  password: string;
  accessToken: string;
  refreshToken: string;
}

export async function loginAs(testUser: TestUser): Promise<Session> {
  const res = await request(testApp())
    .post('/api/v1/auth/login')
    .send({ email: testUser.user.email, password: testUser.password });

  if (res.status !== 200) {
    throw new Error(`Login fixture failed with ${String(res.status)}: ${JSON.stringify(res.body)}`);
  }

  return {
    user: testUser.user,
    password: testUser.password,
    accessToken: String(res.body.accessToken),
    refreshToken: String(res.body.refreshToken),
  };
}

export async function createSession(options: TestUserOptions = {}): Promise<Session> {
  return loginAs(await createTestUser(options));
}

export async function adminSession(options: TestUserOptions = {}): Promise<Session> {
  return createSession({ ...options, role: 'admin' });
}

export async function memberSession(options: TestUserOptions = {}): Promise<Session> {
  return createSession({ ...options, role: 'member' });
}

/** `Authorization` header value for a session. */
export function bearer(session: Session): string {
  return `Bearer ${session.accessToken}`;
}
