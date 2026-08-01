import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, getPool } from '../src/db/pool.js';
import { type LogRecord, resetLogSink, setLogSink } from '../src/lib/logger.js';
import { resetRateLimits } from '../src/middleware/rateLimit.js';
import { testApp } from './helpers/app.js';
import {
  adminSession,
  bearer,
  createSession,
  createTestUser,
  memberSession,
  type Session,
} from './helpers/auth.js';
import { resetTables } from './helpers/db.js';

beforeEach(async () => {
  await resetTables();
  resetRateLimits();
});

afterAll(async () => {
  await closePool();
});

const app = () => request(testApp());

/** Every mutating and reading route on this resource, for blanket auth checks. */
const ROUTES: Array<{ method: 'get' | 'post' | 'patch'; path: (id: string) => string }> = [
  { method: 'get', path: () => '/api/v1/users' },
  { method: 'post', path: () => '/api/v1/users' },
  { method: 'patch', path: (id) => `/api/v1/users/${id}` },
  { method: 'post', path: (id) => `/api/v1/users/${id}/reset-password` },
];

describe('authorization', () => {
  it('refuses every route to an anonymous caller', async () => {
    const id = randomUUID();

    for (const route of ROUTES) {
      const res = await app()[route.method](route.path(id));
      expect(res.status, `${route.method} ${route.path(id)}`).toBe(401);
    }
  });

  it('refuses every route to a member', async () => {
    const member = await memberSession();
    const id = randomUUID();

    for (const route of ROUTES) {
      const res = await app()[route.method](route.path(id))
        .set('Authorization', bearer(member))
        .send({});
      expect(res.status, `${route.method} ${route.path(id)}`).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
  });

  it('refuses a member even for their own account', async () => {
    const member = await memberSession();

    const res = await app()
      .patch(`/api/v1/users/${member.user.id}`)
      .set('Authorization', bearer(member))
      .send({ role: 'admin' });

    expect(res.status).toBe(403);

    const [rows] = await getPool().execute('SELECT role FROM users WHERE id = ?', [
      member.user.id,
    ]);
    expect((rows as { role: string }[])[0]?.role).toBe('member');
  });

  it('refuses an admin who has not yet changed their password', async () => {
    const forced = await createSession({ role: 'admin', mustChangePassword: true });

    const res = await app().get('/api/v1/users').set('Authorization', bearer(forced));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
  });
});

describe('GET /users', () => {
  it('lists every account, including deactivated ones, without credentials', async () => {
    const admin = await adminSession({ displayName: 'Aaron Admin' });
    await createTestUser({ displayName: 'Beth Member' });
    await createTestUser({ displayName: 'Carl Retired', isActive: false });

    const res = await app().get('/api/v1/users').set('Authorization', bearer(admin));

    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(3);
    expect(res.body.users.map((u: { displayName: string }) => u.displayName)).toEqual([
      'Aaron Admin',
      'Beth Member',
      'Carl Retired',
    ]);
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    expect(JSON.stringify(res.body)).not.toContain('$2b$');
  });
});

describe('POST /users', () => {
  it('creates an account and returns the temporary password once', async () => {
    const admin = await adminSession();

    const res = await app()
      .post('/api/v1/users')
      .set('Authorization', bearer(admin))
      .send({ displayName: 'Rachel Bagley', email: 'Rachel@Example.com', role: 'member' });

    expect(res.status).toBe(201);
    expect(res.body.temporaryPassword).toHaveLength(20);
    expect(res.body.user).toMatchObject({
      displayName: 'Rachel Bagley',
      email: 'rachel@example.com', // normalized
      role: 'member',
      mustChangePassword: true,
      isActive: true,
    });
    expect(res.body.user).not.toHaveProperty('passwordHash');
  });

  it('produces an account that can sign in and is then gated', async () => {
    const admin = await adminSession();

    const created = await app()
      .post('/api/v1/users')
      .set('Authorization', bearer(admin))
      .send({ displayName: 'Rachel Bagley', email: 'rachel@example.com', role: 'member' });

    const login = await app()
      .post('/api/v1/auth/login')
      .send({ email: 'rachel@example.com', password: created.body.temporaryPassword });

    expect(login.status).toBe(200);
    expect(login.body.user.mustChangePassword).toBe(true);

    const gated = await app()
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${String(login.body.accessToken)}`);
    expect(gated.status).toBe(403);
    expect(gated.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
  });

  it('issues a different temporary password to each account', async () => {
    const admin = await adminSession();

    const first = await app()
      .post('/api/v1/users')
      .set('Authorization', bearer(admin))
      .send({ displayName: 'One', email: 'one@example.com', role: 'member' });
    const second = await app()
      .post('/api/v1/users')
      .set('Authorization', bearer(admin))
      .send({ displayName: 'Two', email: 'two@example.com', role: 'member' });

    expect(first.body.temporaryPassword).not.toBe(second.body.temporaryPassword);
  });

  it('rejects an email that differs from an existing one only in case', async () => {
    const admin = await adminSession();
    await createTestUser({ email: 'zach@example.com' });

    const res = await app()
      .post('/api/v1/users')
      .set('Authorization', bearer(admin))
      .send({ displayName: 'Impostor', email: 'ZACH@Example.COM', role: 'member' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_IN_USE');
  });

  it('validates its input', async () => {
    const admin = await adminSession();

    const cases = [
      { displayName: '', email: 'a@example.com', role: 'member' },
      { displayName: 'No Email', role: 'member' },
      { displayName: 'Bad Email', email: 'not-an-email', role: 'member' },
      { displayName: 'Bad Role', email: 'b@example.com', role: 'superuser' },
      { displayName: 'Sneaky', email: 'c@example.com', role: 'member', isActive: false },
    ];

    for (const body of cases) {
      const res = await app()
        .post('/api/v1/users')
        .set('Authorization', bearer(admin))
        .send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it('refuses fields the caller is not allowed to set', async () => {
    const admin = await adminSession();

    const res = await app()
      .post('/api/v1/users')
      .set('Authorization', bearer(admin))
      .send({
        displayName: 'Rachel',
        email: 'rachel@example.com',
        role: 'member',
        passwordHash: 'injected',
        mustChangePassword: false,
      });

    // Rejected outright rather than silently ignored, so a client cannot
    // believe it set a privileged field when it did not.
    expect(res.status).toBe(400);
  });
});

describe('PATCH /users/:id', () => {
  it('updates the editable fields', async () => {
    const admin = await adminSession();
    const { user } = await createTestUser({ displayName: 'Old Name' });

    const res = await app()
      .patch(`/api/v1/users/${user.id}`)
      .set('Authorization', bearer(admin))
      .send({ displayName: 'New Name', role: 'admin' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ displayName: 'New Name', role: 'admin' });
  });

  it('takes effect on the target immediately, without a new sign-in', async () => {
    const admin = await adminSession();
    const member = await memberSession();

    // Promoted mid-session: the role is read from the database per request.
    await app()
      .patch(`/api/v1/users/${member.user.id}`)
      .set('Authorization', bearer(admin))
      .send({ role: 'admin' });

    const nowAdmin = await app().get('/api/v1/users').set('Authorization', bearer(member));
    expect(nowAdmin.status).toBe(200);
  });

  it('ends the target’s sessions when deactivating', async () => {
    const admin = await adminSession();
    const member = await memberSession();

    const res = await app()
      .patch(`/api/v1/users/${member.user.id}`)
      .set('Authorization', bearer(admin))
      .send({ isActive: false });

    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(false);

    // The in-flight access token stops working.
    const withAccessToken = await app().get('/api/v1/me').set('Authorization', bearer(member));
    expect(withAccessToken.status).toBe(403);
    expect(withAccessToken.body.error.code).toBe('ACCOUNT_DISABLED');

    // And so does the refresh token.
    const withRefreshToken = await app()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: member.refreshToken });
    expect(withRefreshToken.status).toBe(401);

    // And they cannot sign back in.
    const login = await app()
      .post('/api/v1/auth/login')
      .send({ email: member.user.email, password: member.password });
    expect(login.status).toBe(401);
  });

  it('lets a reactivated account sign in again', async () => {
    const admin = await adminSession();
    const member = await createTestUser({ isActive: false });

    await app()
      .patch(`/api/v1/users/${member.user.id}`)
      .set('Authorization', bearer(admin))
      .send({ isActive: true });

    const login = await app()
      .post('/api/v1/auth/login')
      .send({ email: member.user.email, password: member.password });

    expect(login.status).toBe(200);
  });

  it('refuses to let an admin demote or deactivate themselves', async () => {
    const admin = await adminSession();

    const demote = await app()
      .patch(`/api/v1/users/${admin.user.id}`)
      .set('Authorization', bearer(admin))
      .send({ role: 'member' });
    const deactivate = await app()
      .patch(`/api/v1/users/${admin.user.id}`)
      .set('Authorization', bearer(admin))
      .send({ isActive: false });

    expect(demote.status).toBe(403);
    expect(deactivate.status).toBe(403);

    // Still an active admin.
    const me = await app().get('/api/v1/me').set('Authorization', bearer(admin));
    expect(me.body).toMatchObject({ role: 'admin', isActive: true });
  });

  it('still lets an admin rename themselves', async () => {
    const admin = await adminSession();

    const res = await app()
      .patch(`/api/v1/users/${admin.user.id}`)
      .set('Authorization', bearer(admin))
      .send({ displayName: 'Zach B.' });

    expect(res.status).toBe(200);
    expect(res.body.displayName).toBe('Zach B.');
  });

  it('lets one admin deactivate another', async () => {
    const admin = await adminSession();
    const other = await createTestUser({ role: 'admin' });

    const res = await app()
      .patch(`/api/v1/users/${other.user.id}`)
      .set('Authorization', bearer(admin))
      .send({ isActive: false });

    expect(res.status).toBe(200);
  });

  it('cannot change an email or a password', async () => {
    const admin = await adminSession();
    const { user } = await createTestUser({ email: 'original@example.com' });

    const res = await app()
      .patch(`/api/v1/users/${user.id}`)
      .set('Authorization', bearer(admin))
      .send({ email: 'changed@example.com', password: 'brand-new-password' });

    // No editable field supplied, so the request is rejected outright rather
    // than silently succeeding while ignoring both fields.
    expect(res.status).toBe(400);

    const [rows] = await getPool().execute('SELECT email FROM users WHERE id = ?', [user.id]);
    expect((rows as { email: string }[])[0]?.email).toBe('original@example.com');
  });

  it('rejects an empty change and an unknown account', async () => {
    const admin = await adminSession();

    const empty = await app()
      .patch(`/api/v1/users/${admin.user.id}`)
      .set('Authorization', bearer(admin))
      .send({});
    expect(empty.status).toBe(400);

    const missing = await app()
      .patch(`/api/v1/users/${randomUUID()}`)
      .set('Authorization', bearer(admin))
      .send({ displayName: 'Ghost' });
    expect(missing.status).toBe(404);

    const malformedId = await app()
      .patch('/api/v1/users/not-a-uuid')
      .set('Authorization', bearer(admin))
      .send({ displayName: 'Ghost' });
    expect(malformedId.status).toBe(400);
  });
});

describe('POST /users/:id/reset-password', () => {
  async function resetFor(admin: Session, targetId: string) {
    return app()
      .post(`/api/v1/users/${targetId}/reset-password`)
      .set('Authorization', bearer(admin))
      .send({});
  }

  it('issues a new temporary password and forces a change', async () => {
    const admin = await adminSession();
    const member = await createTestUser();

    const res = await resetFor(admin, member.user.id);

    expect(res.status).toBe(200);
    expect(res.body.temporaryPassword).toHaveLength(20);

    const login = await app()
      .post('/api/v1/auth/login')
      .send({ email: member.user.email, password: res.body.temporaryPassword });

    expect(login.status).toBe(200);
    expect(login.body.user.mustChangePassword).toBe(true);
  });

  it('invalidates the old password and existing sessions', async () => {
    const admin = await adminSession();
    const member = await memberSession();

    await resetFor(admin, member.user.id);

    // A reset that left a signed-in device working would be cosmetic.
    const oldAccess = await app().get('/api/v1/me').set('Authorization', bearer(member));
    expect(oldAccess.status).toBe(200); // access token still valid until expiry…
    const oldRefresh = await app()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: member.refreshToken });
    expect(oldRefresh.status).toBe(401); // …but the session cannot be renewed

    const oldPassword = await app()
      .post('/api/v1/auth/login')
      .send({ email: member.user.email, password: member.password });
    expect(oldPassword.status).toBe(401);
  });

  it('returns 404 for an unknown account', async () => {
    const admin = await adminSession();

    const res = await resetFor(admin, randomUUID());
    expect(res.status).toBe(404);
  });
});

describe('credential leakage', () => {
  it('keeps temporary passwords out of the log entirely', async () => {
    const admin = await adminSession();

    const captured: LogRecord[] = [];
    setLogSink((record) => captured.push(record));

    let created;
    let reset;
    try {
      created = await app()
        .post('/api/v1/users')
        .set('Authorization', bearer(admin))
        .send({ displayName: 'Rachel', email: 'rachel@example.com', role: 'member' });

      reset = await app()
        .post(`/api/v1/users/${String(created.body.user.id)}/reset-password`)
        .set('Authorization', bearer(admin))
        .send({});
    } finally {
      resetLogSink();
    }

    const text = captured.map((r) => `${r.event} ${JSON.stringify(r.fields)}`).join('\n');

    expect(text).toContain('/api/v1/users');
    expect(text).not.toContain(created.body.temporaryPassword);
    expect(text).not.toContain(reset.body.temporaryPassword);
    expect(text).not.toContain('rachel@example.com');
  });

  it('returns a temporary password from exactly the two documented responses', async () => {
    const admin = await adminSession();

    const created = await app()
      .post('/api/v1/users')
      .set('Authorization', bearer(admin))
      .send({ displayName: 'Rachel', email: 'rachel@example.com', role: 'member' });
    const userId = String(created.body.user.id);

    const list = await app().get('/api/v1/users').set('Authorization', bearer(admin));
    const patched = await app()
      .patch(`/api/v1/users/${userId}`)
      .set('Authorization', bearer(admin))
      .send({ displayName: 'Rachel B.' });
    const login = await app()
      .post('/api/v1/auth/login')
      .send({ email: 'rachel@example.com', password: created.body.temporaryPassword });

    // The value exists in the creation response and nowhere else afterwards.
    for (const [name, res] of [
      ['list', list],
      ['patch', patched],
      ['login', login],
    ] as const) {
      expect(JSON.stringify(res.body), name).not.toContain(created.body.temporaryPassword);
      expect(JSON.stringify(res.body), name).not.toContain('temporaryPassword');
    }
  });
});
