import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, getPool } from '../src/db/pool.js';
import { insertRefreshToken } from '../src/db/queries/refreshTokens.js';
import { findUserById } from '../src/db/queries/users.js';
import { resetRateLimits } from '../src/middleware/rateLimit.js';
import { hashRefreshToken } from '../src/services/tokenService.js';
import { testApp } from './helpers/app.js';
import {
  bearer,
  createSession,
  createTestUser,
  DEFAULT_PASSWORD,
  loginAs,
  memberSession,
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

describe('POST /auth/login', () => {
  it('signs in a valid user and returns a token pair', async () => {
    const { user } = await createTestUser({ email: 'zach@example.com' });

    const res = await app()
      .post('/api/v1/auth/login')
      .send({ email: 'zach@example.com', password: DEFAULT_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ id: user.id, email: 'zach@example.com', role: 'member' });
  });

  it('never includes the password hash in the response', async () => {
    await createTestUser({ email: 'zach@example.com' });

    const res = await app()
      .post('/api/v1/auth/login')
      .send({ email: 'zach@example.com', password: DEFAULT_PASSWORD });

    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    expect(JSON.stringify(res.body)).not.toContain('$2b$');
  });

  it('accepts the email in any case', async () => {
    await createTestUser({ email: 'zach@example.com' });

    const res = await app()
      .post('/api/v1/auth/login')
      .send({ email: '  ZACH@Example.COM  ', password: DEFAULT_PASSWORD });

    expect(res.status).toBe(200);
  });

  it('records the login time', async () => {
    const { user } = await createTestUser();
    expect(user.lastLoginAt).toBeNull();

    await app()
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: DEFAULT_PASSWORD });

    const after = await findUserById(user.id);
    expect(after?.lastLoginAt).toEqual(expect.any(String));
  });

  it('answers identically for an unknown email, a wrong password, and a disabled account', async () => {
    await createTestUser({ email: 'real@example.com' });
    await createTestUser({ email: 'disabled@example.com', isActive: false });

    const unknown = await app()
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.com', password: DEFAULT_PASSWORD });
    const wrongPassword = await app()
      .post('/api/v1/auth/login')
      .send({ email: 'real@example.com', password: 'not-the-right-password' });
    const disabled = await app()
      .post('/api/v1/auth/login')
      .send({ email: 'disabled@example.com', password: DEFAULT_PASSWORD });

    // Identical status and body: nothing distinguishes an account that exists
    // from one that does not, or a disabled account from a wrong password.
    expect(unknown.status).toBe(401);
    expect(wrongPassword.status).toBe(401);
    expect(disabled.status).toBe(401);
    expect(unknown.body).toEqual(wrongPassword.body);
    expect(disabled.body).toEqual(wrongPassword.body);
    expect(unknown.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('issues tokens to a user who must change their password', async () => {
    const { user } = await createTestUser({ mustChangePassword: true });

    const res = await app()
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: DEFAULT_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.user.mustChangePassword).toBe(true);
  });

  it('rejects a malformed body', async () => {
    const res = await app().post('/api/v1/auth/login').send({ email: 'not-an-email' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('login rate limiting', () => {
  it('locks an email out after ten failures and clears the count on success', async () => {
    const { user } = await createTestUser({ email: 'target@example.com' });

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const res = await app()
        .post('/api/v1/auth/login')
        .send({ email: 'target@example.com', password: 'wrong-password-here' });
      expect(res.status).toBe(401);
    }

    const blocked = await app()
      .post('/api/v1/auth/login')
      .send({ email: 'target@example.com', password: DEFAULT_PASSWORD });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');

    // A different account from the same source is unaffected.
    const other = await createTestUser({ email: 'other@example.com' });
    const otherRes = await app()
      .post('/api/v1/auth/login')
      .send({ email: 'other@example.com', password: other.password });
    expect(otherRes.status).toBe(200);

    resetRateLimits();
    const recovered = await app()
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: DEFAULT_PASSWORD });
    expect(recovered.status).toBe(200);
  });

  it('limits by source address independently of the email', async () => {
    // Malformed attempts count toward the per-IP bucket, which is what stops
    // one source spraying many different accounts.
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const res = await app().post('/api/v1/auth/login').send({});
      expect(res.status).toBe(400);
    }

    const valid = await createTestUser({ email: 'victim@example.com' });
    const blocked = await app()
      .post('/api/v1/auth/login')
      .send({ email: 'victim@example.com', password: valid.password });

    expect(blocked.status).toBe(429);
  });
});

describe('POST /auth/refresh', () => {
  it('rotates the token and revokes the one presented', async () => {
    const session = await memberSession();

    const res = await app()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: session.refreshToken });

    expect(res.status).toBe(200);
    expect(res.body.refreshToken).not.toBe(session.refreshToken);

    const reuse = await app()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: session.refreshToken });
    expect(reuse.status).toBe(401);
  });

  it('revokes the whole family when a revoked token is replayed', async () => {
    const session = await memberSession();

    const first = await app()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: session.refreshToken });
    const liveToken = String(first.body.refreshToken);

    // Replaying the original signals theft.
    const replay = await app()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: session.refreshToken });
    expect(replay.status).toBe(401);

    // The legitimate holder is signed out too — both parties lose the session,
    // which is the point: the theft becomes visible instead of silent.
    const afterReplay = await app().post('/api/v1/auth/refresh').send({ refreshToken: liveToken });
    expect(afterReplay.status).toBe(401);
  });

  it('does not treat a session killed by a password change as theft', async () => {
    // A password change revokes every session. When the user's other device
    // wakes up and refreshes, it presents a revoked token — expected, not
    // theft. Treating it as theft would revoke the session the user just
    // created by changing their password, signing them out of the device they
    // were sitting at.
    const testUser = await createTestUser();
    const phone = await loginAs(testUser);
    const laptop = await loginAs(testUser);

    const changed = await app()
      .post('/api/v1/auth/change-password')
      .set('Authorization', bearer(phone))
      .send({ currentPassword: phone.password, newPassword: 'a-brand-new-passphrase-2026' });
    expect(changed.status).toBe(200);

    const staleDevice = await app()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: laptop.refreshToken });
    expect(staleDevice.status).toBe(401);

    // The session created by the change is still good.
    const stillValid = await app()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: String(changed.body.refreshToken) });
    expect(stillValid.status).toBe(200);
  });

  it('does not treat a logged-out token as theft', async () => {
    const testUser = await createTestUser();
    const phone = await loginAs(testUser);
    const laptop = await loginAs(testUser);

    await app().post('/api/v1/auth/logout').send({ refreshToken: phone.refreshToken });

    const retry = await app()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: phone.refreshToken });
    expect(retry.status).toBe(401);

    // The other device is untouched by one device signing out.
    const other = await app()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: laptop.refreshToken });
    expect(other.status).toBe(200);
  });

  it('rejects an expired refresh token', async () => {
    const { user } = await createTestUser();
    const token = 'expired-token-value-for-testing';

    await insertRefreshToken({
      userId: user.id,
      tokenHash: hashRefreshToken(token),
      expiresAt: '2020-01-01T00:00:00.000Z',
    });

    const res = await app().post('/api/v1/auth/refresh').send({ refreshToken: token });
    expect(res.status).toBe(401);
  });

  it('rejects an unknown refresh token', async () => {
    const res = await app().post('/api/v1/auth/refresh').send({ refreshToken: 'nonsense' });
    expect(res.status).toBe(401);
  });

  it("stops working once the user's account is deactivated", async () => {
    const session = await memberSession();

    await getPool().execute('UPDATE users SET is_active = 0 WHERE id = ?', [session.user.id]);

    const res = await app()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: session.refreshToken });

    expect(res.status).toBe(401);
  });
});

describe('POST /auth/logout', () => {
  it('revokes the presented refresh token', async () => {
    const session = await memberSession();

    const res = await app()
      .post('/api/v1/auth/logout')
      .send({ refreshToken: session.refreshToken });
    expect(res.status).toBe(204);

    const afterLogout = await app()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: session.refreshToken });
    expect(afterLogout.status).toBe(401);
  });

  it('is idempotent for an unknown or already-revoked token', async () => {
    const session = await memberSession();

    await app().post('/api/v1/auth/logout').send({ refreshToken: session.refreshToken });
    const second = await app()
      .post('/api/v1/auth/logout')
      .send({ refreshToken: session.refreshToken });
    const unknown = await app().post('/api/v1/auth/logout').send({ refreshToken: 'never-existed' });

    expect(second.status).toBe(204);
    expect(unknown.status).toBe(204);
  });
});

describe('GET /me', () => {
  it('returns the caller without any credential material', async () => {
    const session = await memberSession();

    const res = await app().get('/api/v1/me').set('Authorization', bearer(session));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: session.user.id, email: session.user.email });
    expect(res.body).not.toHaveProperty('passwordHash');
  });

  it('rejects a missing, malformed, or forged token', async () => {
    const anonymous = await app().get('/api/v1/me');
    const malformed = await app().get('/api/v1/me').set('Authorization', 'Bearer not.a.jwt');
    const wrongScheme = await app().get('/api/v1/me').set('Authorization', 'Basic abc123');
    // Signed with the right shape but the wrong secret.
    const forged = await app()
      .get('/api/v1/me')
      .set(
        'Authorization',
        'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhYmMifQ.wrong-signature',
      );

    expect(anonymous.status).toBe(401);
    expect(malformed.status).toBe(401);
    expect(wrongScheme.status).toBe(401);
    expect(forged.status).toBe(401);
  });

  it('reflects deactivation immediately, without waiting for the token to expire', async () => {
    const session = await memberSession();

    await getPool().execute('UPDATE users SET is_active = 0 WHERE id = ?', [session.user.id]);

    const res = await app().get('/api/v1/me').set('Authorization', bearer(session));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
  });

  it('reflects a role change immediately', async () => {
    const session = await memberSession();

    await getPool().execute("UPDATE users SET role = 'admin' WHERE id = ?", [session.user.id]);

    const res = await app().get('/api/v1/me').set('Authorization', bearer(session));
    expect(res.body.role).toBe('admin');
  });
});

describe('the password-change gate', () => {
  it('blocks every route except /me and change-password', async () => {
    const forced = await createSession({ mustChangePassword: true });

    // /api/v1/nope sits behind the globally mounted gate, so it reports the
    // gate rather than 404 — proof the gate is in front of everything.
    const gated = await app().get('/api/v1/nope').set('Authorization', bearer(forced));
    expect(gated.status).toBe(403);
    expect(gated.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const me = await app().get('/api/v1/me').set('Authorization', bearer(forced));
    expect(me.status).toBe(200);

    const change = await app()
      .post('/api/v1/auth/change-password')
      .set('Authorization', bearer(forced))
      .send({ currentPassword: forced.password, newPassword: 'a-brand-new-passphrase-2026' });
    expect(change.status).toBe(200);
  });

  it('lets a gated user refresh, so the change can survive an expired access token', async () => {
    const forced = await createSession({ mustChangePassword: true });

    const res = await app()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: forced.refreshToken });

    expect(res.status).toBe(200);
    expect(res.body.user.mustChangePassword).toBe(true);
  });

  it('opens the app once the password has been changed', async () => {
    const forced = await createSession({ mustChangePassword: true });

    const change = await app()
      .post('/api/v1/auth/change-password')
      .set('Authorization', bearer(forced))
      .send({ currentPassword: forced.password, newPassword: 'a-brand-new-passphrase-2026' });

    expect(change.body.user.mustChangePassword).toBe(false);

    const after = await app()
      .get('/api/v1/nope')
      .set('Authorization', `Bearer ${String(change.body.accessToken)}`);
    expect(after.status).toBe(404);
  });
});

describe('POST /auth/change-password', () => {
  it('requires authentication', async () => {
    const res = await app()
      .post('/api/v1/auth/change-password')
      .send({ currentPassword: DEFAULT_PASSWORD, newPassword: 'another-good-passphrase-99' });

    expect(res.status).toBe(401);
  });

  it('requires the correct current password', async () => {
    const session = await memberSession();

    const res = await app()
      .post('/api/v1/auth/change-password')
      .set('Authorization', bearer(session))
      .send({ currentPassword: 'wrong-current-password', newPassword: 'another-good-passphrase-99' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('enforces the password policy', async () => {
    const session = await memberSession();

    const cases: Array<[string, string]> = [
      ['short', 'too short'],
      ['passwordpassword', 'a common password'],
      [session.password, 'the same as the current one'],
    ];

    for (const [newPassword, description] of cases) {
      const res = await app()
        .post('/api/v1/auth/change-password')
        .set('Authorization', bearer(session))
        .send({ currentPassword: session.password, newPassword });

      expect(res.status, description).toBe(400);
      expect(res.body.error.code, description).toBe('VALIDATION_ERROR');
    }
  });

  it('rejects a common password regardless of case', async () => {
    const session = await memberSession();

    const res = await app()
      .post('/api/v1/auth/change-password')
      .set('Authorization', bearer(session))
      .send({ currentPassword: session.password, newPassword: 'PasswordPassword' });

    expect(res.status).toBe(400);
  });

  it('signs out every other device and issues a working new pair', async () => {
    const testUser = await createTestUser();
    const phone = await loginAs(testUser);
    const laptop = await loginAs(testUser);

    const res = await app()
      .post('/api/v1/auth/change-password')
      .set('Authorization', bearer(phone))
      .send({ currentPassword: phone.password, newPassword: 'a-brand-new-passphrase-2026' });

    expect(res.status).toBe(200);

    // The other device's refresh token no longer works.
    const laptopRefresh = await app()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: laptop.refreshToken });
    expect(laptopRefresh.status).toBe(401);

    // The pair returned by the change does.
    const newRefresh = await app()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: String(res.body.refreshToken) });
    expect(newRefresh.status).toBe(200);

    const me = await app()
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${String(res.body.accessToken)}`);
    expect(me.status).toBe(200);
  });

  it('lets the user sign in with the new password and not the old one', async () => {
    const session = await memberSession();

    await app()
      .post('/api/v1/auth/change-password')
      .set('Authorization', bearer(session))
      .send({ currentPassword: session.password, newPassword: 'a-brand-new-passphrase-2026' });

    resetRateLimits();

    const withOld = await app()
      .post('/api/v1/auth/login')
      .send({ email: session.user.email, password: session.password });
    const withNew = await app()
      .post('/api/v1/auth/login')
      .send({ email: session.user.email, password: 'a-brand-new-passphrase-2026' });

    expect(withOld.status).toBe(401);
    expect(withNew.status).toBe(200);
  });
});

describe('account creation surface', () => {
  it('has no registration endpoint', async () => {
    const res = await app()
      .post('/api/v1/auth/register')
      .send({ email: 'intruder@example.com', password: 'a-perfectly-fine-password' });

    // No route, and the gate sits in front of the fallback, so an anonymous
    // caller gets 401 — either way, no account is created.
    expect([401, 404]).toContain(res.status);

    const [rows] = await getPool().query('SELECT COUNT(*) AS count FROM users');
    expect(Number((rows as { count: number }[])[0]?.count)).toBe(0);
  });
});
