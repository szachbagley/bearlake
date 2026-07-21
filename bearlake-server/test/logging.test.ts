import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closePool } from '../src/db/pool.js';
import { type LogRecord, resetLogSink, setLogSink } from '../src/lib/logger.js';
import { resetRateLimits } from '../src/middleware/rateLimit.js';
import { testApp } from './helpers/app.js';
import { bearer, createTestUser, loginAs } from './helpers/auth.js';
import { resetTables } from './helpers/db.js';

/**
 * Guards plan D26. Later phases extend this file as routes that handle
 * credentials and gate codes come online; the invariant never changes.
 */

let records: LogRecord[] = [];

beforeEach(() => {
  records = [];
  setLogSink((record) => records.push(record));
});

afterEach(() => {
  resetLogSink();
});

function loggedText(): string {
  return records
    .map((r) => `${r.event} ${JSON.stringify(r.fields)}`)
    .join('\n');
}

describe('request logging', () => {
  it('logs the full request path consistently for matched and unmatched routes', async () => {
    await request(testApp()).get('/api/v1/health');
    await request(testApp()).get('/api/v1/nope');

    const paths = records.filter((r) => r.event === 'request').map((r) => r.fields['path']);
    expect(paths).toEqual(['/api/v1/health', '/api/v1/nope']);
  });

  it('never logs the query string', async () => {
    await request(testApp()).get('/api/v1/health?start=2026-07-01&secret=abc123');

    expect(loggedText()).not.toContain('secret');
    expect(loggedText()).not.toContain('abc123');
    expect(loggedText()).toContain('/api/v1/health');
  });

  it('never logs a request body', async () => {
    await request(testApp())
      .post('/api/v1/health')
      .send({ password: 'correct-horse-battery-staple' });

    expect(loggedText()).not.toContain('correct-horse-battery-staple');
    expect(loggedText()).not.toContain('password');
  });
});

describe('credential leakage', () => {
  afterAll(async () => {
    await closePool();
  });

  it('leaks nothing through a full sign-in and password change', async () => {
    // Fixtures run before the sink is watched so only the flow under test is
    // captured; resetTables must not be inside the watched window either.
    resetLogSink();
    await resetTables();
    resetRateLimits();
    const testUser = await createTestUser({ email: 'zach@example.com' });
    const session = await loginAs(testUser);

    const captured: LogRecord[] = [];
    setLogSink((record) => captured.push(record));

    const login = await request(testApp())
      .post('/api/v1/auth/login')
      .send({ email: 'zach@example.com', password: testUser.password });

    const changed = await request(testApp())
      .post('/api/v1/auth/change-password')
      .set('Authorization', bearer(session))
      .send({ currentPassword: testUser.password, newPassword: 'a-brand-new-passphrase-2026' });

    expect(login.status).toBe(200);
    expect(changed.status).toBe(200);

    const text = captured.map((r) => `${r.event} ${JSON.stringify(r.fields)}`).join('\n');

    const mustNotAppear = [
      testUser.password,
      'a-brand-new-passphrase-2026',
      String(login.body.accessToken),
      String(login.body.refreshToken),
      String(changed.body.accessToken),
      String(changed.body.refreshToken),
      '$2b$', // any bcrypt hash
    ];

    for (const secret of mustNotAppear) {
      expect(text, `leaked: ${secret.slice(0, 12)}…`).not.toContain(secret);
    }

    // The requests were logged — this is a real window, not an empty one.
    expect(text).toContain('/api/v1/auth/login');
    expect(text).toContain('/api/v1/auth/change-password');
  });
});
