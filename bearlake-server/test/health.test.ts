import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { testApp } from './helpers/app.js';
import { bearer, memberSession } from './helpers/auth.js';
import { resetTables } from './helpers/db.js';

beforeEach(async () => {
  await resetTables();
});

describe('app skeleton', () => {
  it('serves GET /api/v1/health without authentication', async () => {
    const res = await request(testApp()).get('/api/v1/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('answers 401, not 404, for an unknown path when unauthenticated', async () => {
    // Authentication is mounted ahead of the not-found fallback, so an
    // anonymous caller cannot map which endpoints exist by their status codes.
    const res = await request(testApp()).get('/api/v1/nope');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: { code: 'UNAUTHENTICATED', message: expect.any(String) as string },
    });
  });

  it('returns the standard error shape for an unknown path when authenticated', async () => {
    const session = await memberSession();
    const res = await request(testApp()).get('/api/v1/nope').set('Authorization', bearer(session));

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: expect.any(String) as string },
    });
  });

  it('returns the standard error shape for a malformed JSON body', async () => {
    const res = await request(testApp())
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send('{"title": ');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: { code: 'VALIDATION_ERROR', message: expect.any(String) as string },
    });
  });

  it('does not advertise the server framework', async () => {
    const res = await request(testApp()).get('/api/v1/health');

    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
