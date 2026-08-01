import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool } from '../src/db/pool.js';
import { type LogRecord, resetLogSink, setLogSink } from '../src/lib/logger.js';
import { resetRateLimits } from '../src/middleware/rateLimit.js';
import { testApp } from './helpers/app.js';
import { adminSession, bearer, memberSession, type Session } from './helpers/auth.js';
import { resetTables } from './helpers/db.js';

beforeEach(async () => {
  await resetTables();
  resetRateLimits();
});

afterAll(async () => {
  await closePool();
});

const app = () => request(testApp());

async function post(admin: Session, body: string, sortOrder?: number) {
  const payload: Record<string, unknown> = { body };
  if (sortOrder !== undefined) payload['sortOrder'] = sortOrder;
  return app().post('/api/v1/quick-tips').set('Authorization', bearer(admin)).send(payload);
}

describe('authorization', () => {
  it('lets any member read, but only an admin write', async () => {
    const admin = await adminSession();
    const member = await memberSession();
    const created = await post(admin, 'Marina code: 031301');
    const id = String(created.body.id);

    expect((await app().get('/api/v1/quick-tips').set('Authorization', bearer(member))).status).toBe(200);

    for (const res of [
      await app().post('/api/v1/quick-tips').set('Authorization', bearer(member)).send({ body: 'x' }),
      await app().patch(`/api/v1/quick-tips/${id}`).set('Authorization', bearer(member)).send({ body: 'x' }),
      await app().delete(`/api/v1/quick-tips/${id}`).set('Authorization', bearer(member)),
    ]) {
      expect(res.status).toBe(403);
    }
  });

  it('rejects anonymous callers on every route', async () => {
    const id = randomUUID();
    expect((await app().get('/api/v1/quick-tips')).status).toBe(401);
    expect((await app().post('/api/v1/quick-tips').send({ body: 'x' })).status).toBe(401);
    expect((await app().patch(`/api/v1/quick-tips/${id}`).send({ body: 'x' })).status).toBe(401);
    expect((await app().delete(`/api/v1/quick-tips/${id}`)).status).toBe(401);
  });
});

describe('POST /quick-tips', () => {
  it('creates a tip that appends to the end by default', async () => {
    const admin = await adminSession();

    const first = await post(admin, 'first');
    const second = await post(admin, 'second');

    expect(first.status).toBe(201);
    // Each new tip lands one past the current maximum.
    expect(first.body.sortOrder).toBe(0);
    expect(second.body.sortOrder).toBe(1);
  });

  it('accepts an explicit sort order', async () => {
    const admin = await adminSession();

    const res = await post(admin, 'pinned', 100);
    expect(res.body.sortOrder).toBe(100);
  });

  it('validates the body', async () => {
    const admin = await adminSession();

    expect((await post(admin, '')).status).toBe(400);
    expect((await post(admin, '   ')).status).toBe(400);
    expect((await post(admin, 'x'.repeat(1001))).status).toBe(400);

    const unknownField = await app()
      .post('/api/v1/quick-tips')
      .set('Authorization', bearer(admin))
      .send({ body: 'ok', createdBy: randomUUID() });
    expect(unknownField.status).toBe(400);
  });
});

describe('GET /quick-tips', () => {
  it('returns tips in sortOrder, then creation order', async () => {
    const admin = await adminSession();
    await post(admin, 'gamma', 20);
    await post(admin, 'alpha', 10);
    await post(admin, 'beta', 10); // ties with alpha; creation order breaks it

    const res = await app().get('/api/v1/quick-tips').set('Authorization', bearer(admin));

    expect(res.status).toBe(200);
    expect((res.body.quickTips as { body: string }[]).map((t) => t.body)).toEqual([
      'alpha',
      'beta',
      'gamma',
    ]);
  });
});

describe('PATCH /quick-tips/:id', () => {
  it('updates the body, the sort order, or both', async () => {
    const admin = await adminSession();
    const created = await post(admin, 'original', 5);

    const res = await app()
      .patch(`/api/v1/quick-tips/${String(created.body.id)}`)
      .set('Authorization', bearer(admin))
      .send({ body: 'reworded', sortOrder: 2 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ body: 'reworded', sortOrder: 2 });
  });

  it('reorders tips via sortOrder alone', async () => {
    const admin = await adminSession();
    const a = await post(admin, 'a', 0);
    await post(admin, 'b', 1);

    // Move 'a' to the end.
    await app()
      .patch(`/api/v1/quick-tips/${String(a.body.id)}`)
      .set('Authorization', bearer(admin))
      .send({ sortOrder: 10 });

    const res = await app().get('/api/v1/quick-tips').set('Authorization', bearer(admin));
    expect((res.body.quickTips as { body: string }[]).map((t) => t.body)).toEqual(['b', 'a']);
  });

  it('rejects an empty patch and returns 404 for an unknown tip', async () => {
    const admin = await adminSession();
    const created = await post(admin, 'x');

    const empty = await app()
      .patch(`/api/v1/quick-tips/${String(created.body.id)}`)
      .set('Authorization', bearer(admin))
      .send({});
    expect(empty.status).toBe(400);

    const missing = await app()
      .patch(`/api/v1/quick-tips/${randomUUID()}`)
      .set('Authorization', bearer(admin))
      .send({ body: 'x' });
    expect(missing.status).toBe(404);
  });
});

describe('DELETE /quick-tips/:id', () => {
  it('deletes a tip and then reports it gone', async () => {
    const admin = await adminSession();
    const created = await post(admin, 'temp');

    expect(
      (await app().delete(`/api/v1/quick-tips/${String(created.body.id)}`).set('Authorization', bearer(admin))).status,
    ).toBe(204);
    expect(
      (await app().delete(`/api/v1/quick-tips/${String(created.body.id)}`).set('Authorization', bearer(admin))).status,
    ).toBe(404);
  });
});

describe('credential leakage', () => {
  it('never logs quick-tip bodies, which carry gate codes and key locations', async () => {
    const admin = await adminSession();
    const secret = 'gate code 031301, pool house key in the electrical box';

    const captured: LogRecord[] = [];
    setLogSink((record) => captured.push(record));
    let created;
    try {
      created = await post(admin, secret);
      await app()
        .patch(`/api/v1/quick-tips/${String(created.body.id)}`)
        .set('Authorization', bearer(admin))
        .send({ body: 'new code 778899' });
      await app().get('/api/v1/quick-tips').set('Authorization', bearer(admin));
    } finally {
      resetLogSink();
    }

    const text = captured.map((r) => `${r.event} ${JSON.stringify(r.fields)}`).join('\n');
    expect(text).toContain('/api/v1/quick-tips');
    expect(text).not.toContain('031301');
    expect(text).not.toContain('778899');
    expect(text).not.toContain('electrical box');
  });
});
