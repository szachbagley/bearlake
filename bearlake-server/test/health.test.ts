import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { testApp } from './helpers/app.js';

describe('app skeleton', () => {
  it('serves GET /api/v1/health', async () => {
    const res = await request(testApp()).get('/api/v1/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('returns the standard error shape for an unknown path', async () => {
    const res = await request(testApp()).get('/api/v1/nope');

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
