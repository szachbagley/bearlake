import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { insertAnnouncement } from '../src/db/queries/announcements.js';
import { closePool, getPool } from '../src/db/pool.js';
import { type LogRecord, resetLogSink, setLogSink } from '../src/lib/logger.js';
import { resetRateLimits } from '../src/middleware/rateLimit.js';
import { encodeCursor } from '../src/services/cursor.js';
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

async function post(admin: Session, body: string) {
  return app().post('/api/v1/announcements').set('Authorization', bearer(admin)).send({ body });
}

describe('authorization', () => {
  it('lets any member read, but only an admin write', async () => {
    const admin = await adminSession();
    const member = await memberSession();
    const created = await post(admin, 'New pool speakers, passcode 0000');
    const id = String(created.body.id);

    expect((await app().get('/api/v1/announcements').set('Authorization', bearer(member))).status).toBe(200);

    for (const res of [
      await app().post('/api/v1/announcements').set('Authorization', bearer(member)).send({ body: 'x' }),
      await app().patch(`/api/v1/announcements/${id}`).set('Authorization', bearer(member)).send({ body: 'x' }),
      await app().delete(`/api/v1/announcements/${id}`).set('Authorization', bearer(member)),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
  });

  it('rejects anonymous callers on every route', async () => {
    const id = randomUUID();
    expect((await app().get('/api/v1/announcements')).status).toBe(401);
    expect((await app().post('/api/v1/announcements').send({ body: 'x' })).status).toBe(401);
    expect((await app().patch(`/api/v1/announcements/${id}`).send({ body: 'x' })).status).toBe(401);
    expect((await app().delete(`/api/v1/announcements/${id}`)).status).toBe(401);
  });
});

describe('POST /announcements', () => {
  it('creates an announcement with a server-set postedAt', async () => {
    const admin = await adminSession();
    const before = Date.now();

    const res = await post(admin, 'The marina passcode this summer is 845256');

    expect(res.status).toBe(201);
    expect(res.body.body).toBe('The marina passcode this summer is 845256');
    expect(res.body.createdBy).toBe(admin.user.id);
    const posted = Date.parse(res.body.postedAt);
    expect(posted).toBeGreaterThanOrEqual(before - 1000);
    expect(posted).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('validates the body', async () => {
    const admin = await adminSession();

    expect((await post(admin, '')).status).toBe(400);
    expect((await post(admin, '   ')).status).toBe(400);
    expect((await post(admin, 'x'.repeat(5001))).status).toBe(400);

    const unknownField = await app()
      .post('/api/v1/announcements')
      .set('Authorization', bearer(admin))
      .send({ body: 'ok', postedAt: '2020-01-01T00:00:00.000Z' });
    expect(unknownField.status).toBe(400);
  });
});

describe('PATCH /announcements/:id', () => {
  it('edits the body but not the posted date', async () => {
    const admin = await adminSession();
    const created = await post(admin, 'original');
    const originalPostedAt = String(created.body.postedAt);

    const res = await app()
      .patch(`/api/v1/announcements/${String(created.body.id)}`)
      .set('Authorization', bearer(admin))
      .send({ body: 'edited' });

    expect(res.status).toBe(200);
    expect(res.body.body).toBe('edited');
    expect(res.body.postedAt).toBe(originalPostedAt);
  });

  it('returns 404 for an unknown announcement', async () => {
    const admin = await adminSession();
    const res = await app()
      .patch(`/api/v1/announcements/${randomUUID()}`)
      .set('Authorization', bearer(admin))
      .send({ body: 'x' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /announcements/:id', () => {
  it('deletes an announcement and then reports it gone', async () => {
    const admin = await adminSession();
    const created = await post(admin, 'temporary');

    expect(
      (await app().delete(`/api/v1/announcements/${String(created.body.id)}`).set('Authorization', bearer(admin))).status,
    ).toBe(204);
    expect(
      (await app().delete(`/api/v1/announcements/${String(created.body.id)}`).set('Authorization', bearer(admin))).status,
    ).toBe(404);
  });
});

describe('GET /announcements pagination', () => {
  /**
   * Seeds 45 announcements directly, controlling posted_at so ties exist:
   * three share each timestamp, which is exactly where a cursor without a
   * tiebreaker would skip or repeat rows.
   */
  async function seed(count: number, admin: Session): Promise<void> {
    for (let i = 0; i < count; i += 1) {
      await insertAnnouncement(`announcement ${String(i).padStart(2, '0')}`, admin.user.id);
    }
    // Collapse timestamps into groups of three to force ties.
    const [rows] = await getPool().query('SELECT id FROM announcements ORDER BY created_at ASC');
    const ids = (rows as { id: string }[]).map((r) => r.id);
    for (const [i, id] of ids.entries()) {
      const minute = String(Math.floor(i / 3)).padStart(2, '0');
      await getPool().execute('UPDATE announcements SET posted_at = ? WHERE id = ?', [
        `2026-07-01 12:${minute}:00.000`,
        id,
      ]);
    }
  }

  it('walks every announcement once, in order, with no gaps or repeats', async () => {
    const admin = await adminSession();
    await seed(45, admin);

    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;

    do {
      const query: Record<string, string> = { limit: '10' };
      if (cursor !== undefined) query['cursor'] = cursor;
      const res = await app().get('/api/v1/announcements').query(query).set('Authorization', bearer(admin));
      expect(res.status).toBe(200);

      seen.push(...(res.body.items as { id: string }[]).map((a) => a.id));
      cursor = res.body.nextCursor ?? undefined;
      pages += 1;
      expect(pages).toBeLessThanOrEqual(10); // guard against an infinite loop
    } while (cursor !== undefined);

    expect(seen).toHaveLength(45);
    expect(new Set(seen).size).toBe(45); // no repeats
    expect(pages).toBe(5); // 45 / 10 → 5 pages

    // Global order matches a direct newest-first query, ties broken by id DESC.
    const [rows] = await getPool().query(
      'SELECT id FROM announcements ORDER BY posted_at DESC, id DESC',
    );
    expect(seen).toEqual((rows as { id: string }[]).map((r) => r.id));
  });

  it('returns a null nextCursor on the final page', async () => {
    const admin = await adminSession();
    await seed(3, admin);

    const res = await app().get('/api/v1/announcements').query({ limit: '10' }).set('Authorization', bearer(admin));
    expect(res.body.items).toHaveLength(3);
    expect(res.body.nextCursor).toBeNull();
  });

  it('defaults and clamps the limit', async () => {
    const admin = await adminSession();

    const tooBig = await app().get('/api/v1/announcements').query({ limit: '999' }).set('Authorization', bearer(admin));
    const zero = await app().get('/api/v1/announcements').query({ limit: '0' }).set('Authorization', bearer(admin));
    const nan = await app().get('/api/v1/announcements').query({ limit: 'abc' }).set('Authorization', bearer(admin));

    expect(tooBig.status).toBe(400);
    expect(zero.status).toBe(400);
    expect(nan.status).toBe(400);
  });

  it('rejects a tampered or malformed cursor', async () => {
    const admin = await adminSession();

    for (const cursor of ['not-base64!!', Buffer.from('garbage').toString('base64url'), 'YWJj',
      encodeCursor({ postedAt: 'not-a-date', id: randomUUID() })]) {
      const res = await app().get('/api/v1/announcements').query({ cursor }).set('Authorization', bearer(admin));
      expect(res.status, cursor).toBe(400);
    }
  });

  it('does not repeat a row when a new announcement is added mid-pagination', async () => {
    // Keyset pagination is stable against inserts, unlike offset pagination.
    const admin = await adminSession();
    await seed(15, admin);

    const first = await app().get('/api/v1/announcements').query({ limit: '10' }).set('Authorization', bearer(admin));
    const firstIds = (first.body.items as { id: string }[]).map((a) => a.id);

    // A newer announcement appears at the very top, off the second page.
    await post(admin, 'breaking: fox family at the bottom of the hill');

    const second = await app()
      .get('/api/v1/announcements')
      .query({ limit: '10', cursor: String(first.body.nextCursor) })
      .set('Authorization', bearer(admin));
    const secondIds = (second.body.items as { id: string }[]).map((a) => a.id);

    // No id from page one reappears on page two.
    expect(firstIds.some((id) => secondIds.includes(id))).toBe(false);
  });
});

describe('credential leakage', () => {
  it('never logs announcement bodies, which carry passcodes', async () => {
    const admin = await adminSession();
    const secret = 'marina passcode 845256 and gate code 031301';

    const captured: LogRecord[] = [];
    setLogSink((record) => captured.push(record));
    let created;
    try {
      created = await post(admin, secret);
      await app()
        .patch(`/api/v1/announcements/${String(created.body.id)}`)
        .set('Authorization', bearer(admin))
        .send({ body: 'updated passcode 999888' });
      await app().get('/api/v1/announcements').set('Authorization', bearer(admin));
    } finally {
      resetLogSink();
    }

    const text = captured.map((r) => `${r.event} ${JSON.stringify(r.fields)}`).join('\n');
    expect(text).toContain('/api/v1/announcements'); // requests were logged
    expect(text).not.toContain('845256');
    expect(text).not.toContain('031301');
    expect(text).not.toContain('999888');
  });
});
