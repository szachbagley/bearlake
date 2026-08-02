import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool } from '../src/db/pool.js';
import { resetRateLimits } from '../src/middleware/rateLimit.js';
import { rawRow } from './helpers/db.js';
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

async function createCategory(admin: Session, title = 'Pool & Hot Tub', sortOrder?: number) {
  const payload: Record<string, unknown> = { title };
  if (sortOrder !== undefined) payload['sortOrder'] = sortOrder;
  const res = await app().post('/api/v1/info/categories').set('Authorization', bearer(admin)).send(payload);
  return res;
}

function block(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: randomUUID(), type: 'paragraph', text: 'Check the chlorine weekly.', ...overrides };
}

async function createArticle(
  admin: Session,
  categoryId: string,
  overrides: Record<string, unknown> = {},
) {
  return app()
    .post('/api/v1/info/articles')
    .set('Authorization', bearer(admin))
    .send({
      categoryId,
      title: 'Monitoring chemicals',
      blocks: [block()],
      status: 'published',
      ...overrides,
    });
}

describe('category authorization', () => {
  it('lets any member read categories but only an admin write', async () => {
    const admin = await adminSession();
    const member = await memberSession();
    const created = await createCategory(admin);
    const id = String(created.body.id);

    expect((await app().get('/api/v1/info/categories').set('Authorization', bearer(member))).status).toBe(200);

    for (const res of [
      await app().post('/api/v1/info/categories').set('Authorization', bearer(member)).send({ title: 'x' }),
      await app().patch(`/api/v1/info/categories/${id}`).set('Authorization', bearer(member)).send({ title: 'x' }),
      await app().delete(`/api/v1/info/categories/${id}`).set('Authorization', bearer(member)),
    ]) {
      expect(res.status).toBe(403);
    }
  });

  it('rejects anonymous callers', async () => {
    expect((await app().get('/api/v1/info/categories')).status).toBe(401);
    expect((await app().post('/api/v1/info/categories').send({ title: 'x' })).status).toBe(401);
  });
});

describe('categories', () => {
  it('creates, lists in order, and updates categories', async () => {
    const admin = await adminSession();
    await createCategory(admin, 'Main Cabin', 20);
    await createCategory(admin, 'Pool & Hot Tub', 10);

    const list = await app().get('/api/v1/info/categories').set('Authorization', bearer(admin));
    expect((list.body.categories as { title: string }[]).map((c) => c.title)).toEqual([
      'Pool & Hot Tub',
      'Main Cabin',
    ]);

    const id = String((list.body.categories as { id: string }[])[0]?.id);
    const patched = await app()
      .patch(`/api/v1/info/categories/${id}`)
      .set('Authorization', bearer(admin))
      .send({ title: 'Pool, Hot Tub & Sauna' });
    expect(patched.body.title).toBe('Pool, Hot Tub & Sauna');
  });

  it('blocks deleting a category that still has articles, then allows it once empty', async () => {
    const admin = await adminSession();
    const category = await createCategory(admin);
    const categoryId = String(category.body.id);
    const article = await createArticle(admin, categoryId);

    const blocked = await app()
      .delete(`/api/v1/info/categories/${categoryId}`)
      .set('Authorization', bearer(admin));
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('CATEGORY_NOT_EMPTY');

    await app().delete(`/api/v1/info/articles/${String(article.body.id)}`).set('Authorization', bearer(admin));

    const allowed = await app()
      .delete(`/api/v1/info/categories/${categoryId}`)
      .set('Authorization', bearer(admin));
    expect(allowed.status).toBe(204);
  });
});

describe('article authorization', () => {
  it('rejects member and anonymous writes on every mutating route', async () => {
    const admin = await adminSession();
    const member = await memberSession();
    const category = await createCategory(admin);
    const article = await createArticle(admin, String(category.body.id));
    const id = String(article.body.id);

    const memberWrites = [
      app().post('/api/v1/info/articles').set('Authorization', bearer(member)).send({}),
      app().patch(`/api/v1/info/articles/${id}`).set('Authorization', bearer(member)).send({ updatedAt: article.body.updatedAt }),
      app().delete(`/api/v1/info/articles/${id}`).set('Authorization', bearer(member)),
    ];
    for (const res of await Promise.all(memberWrites)) {
      expect(res.status).toBe(403);
    }

    const anon = [
      app().post('/api/v1/info/articles').send({}),
      app().patch(`/api/v1/info/articles/${id}`).send({}),
      app().delete(`/api/v1/info/articles/${id}`),
      app().get(`/api/v1/info/articles/${id}`),
    ];
    for (const res of await Promise.all(anon)) {
      expect(res.status).toBe(401);
    }
  });
});

describe('draft gating', () => {
  it('hides drafts from members in the category list but shows them to admins', async () => {
    const admin = await adminSession();
    const member = await memberSession();
    const category = await createCategory(admin);
    const categoryId = String(category.body.id);

    await createArticle(admin, categoryId, { title: 'Published one', status: 'published' });
    await createArticle(admin, categoryId, { title: 'Draft one', status: 'draft' });

    const asMember = await app()
      .get(`/api/v1/info/categories/${categoryId}/articles`)
      .set('Authorization', bearer(member));
    const asAdmin = await app()
      .get(`/api/v1/info/categories/${categoryId}/articles`)
      .set('Authorization', bearer(admin));

    expect((asMember.body.articles as { title: string }[]).map((a) => a.title)).toEqual(['Published one']);
    expect((asAdmin.body.articles as unknown[]).length).toBe(2);
  });

  it('returns 404, not 403, when a member requests a draft directly', async () => {
    const admin = await adminSession();
    const member = await memberSession();
    const category = await createCategory(admin);
    const draft = await createArticle(admin, String(category.body.id), { status: 'draft' });
    const id = String(draft.body.id);

    const asMember = await app().get(`/api/v1/info/articles/${id}`).set('Authorization', bearer(member));
    // 404 (not 403): the response must not confirm the draft exists.
    expect(asMember.status).toBe(404);

    const asAdmin = await app().get(`/api/v1/info/articles/${id}`).set('Authorization', bearer(admin));
    expect(asAdmin.status).toBe(200);
  });

  it('summaries omit blocks', async () => {
    const admin = await adminSession();
    const category = await createCategory(admin);
    await createArticle(admin, String(category.body.id));

    const list = await app()
      .get(`/api/v1/info/categories/${String(category.body.id)}/articles`)
      .set('Authorization', bearer(admin));

    const summary = (list.body.articles as Record<string, unknown>[])[0];
    expect(summary).toBeDefined();
    expect(summary).not.toHaveProperty('blocks');
    expect(summary).toHaveProperty('status');
  });
});

describe('blocks', () => {
  const everyBlockType = (): Record<string, unknown>[] => [
    { id: randomUUID(), type: 'heading', text: 'Pool' },
    { id: randomUUID(), type: 'paragraph', text: 'How to check chlorine.' },
    { id: randomUUID(), type: 'bullets', items: ['Test strips', 'Chlorine tablets'] },
    { id: randomUUID(), type: 'image', key: `articles/${randomUUID()}/${randomUUID()}`, caption: 'The dial' },
    { id: randomUUID(), type: 'video', provider: 'youtube', videoId: 'dQw4w9WgXcQ' },
  ];

  it('round-trips an article with every block type, structurally identical', async () => {
    const admin = await adminSession();
    const category = await createCategory(admin);
    const blocks = everyBlockType();

    const created = await createArticle(admin, String(category.body.id), { blocks });
    const fetched = await app()
      .get(`/api/v1/info/articles/${String(created.body.id)}`)
      .set('Authorization', bearer(admin));

    // Compare parsed structures, not raw JSON (spec §11 note). Image blocks
    // gain a transient url; strip it before comparing to the input.
    const returned = (fetched.body.blocks as Record<string, unknown>[]).map((b) => {
      if (b['type'] === 'image') {
        const { url: _url, ...rest } = b;
        return rest;
      }
      return b;
    });
    expect(returned).toEqual(blocks);
  });

  it('resolves image keys to a transient url without persisting it', async () => {
    const admin = await adminSession();
    const category = await createCategory(admin);
    const key = `articles/${randomUUID()}/${randomUUID()}`;
    const created = await createArticle(admin, String(category.body.id), {
      blocks: [{ id: randomUUID(), type: 'image', key }],
    });
    const id = String(created.body.id);

    const fetched = await app().get(`/api/v1/info/articles/${id}`).set('Authorization', bearer(admin));
    const imageBlock = (fetched.body.blocks as Record<string, unknown>[])[0];
    expect(imageBlock?.['key']).toBe(key);
    expect(imageBlock?.['url']).toEqual(expect.any(String));
    expect(imageBlock?.['url']).not.toBe(key);

    // The stored JSON keeps the key and never the url.
    const row = await rawRow('info_articles', id);
    const storedBlocks = JSON.stringify(row?.['blocks']);
    expect(storedBlocks).toContain(key);
    expect(storedBlocks).not.toContain('url');
  });

  it('rejects invalid block arrays', async () => {
    const admin = await adminSession();
    const category = await createCategory(admin);
    const categoryId = String(category.body.id);
    const sharedId = randomUUID();

    const invalidBlockSets: Array<[string, unknown]> = [
      ['unknown type', [{ id: randomUUID(), type: 'callout', text: 'x' }]],
      ['duplicate ids', [{ id: sharedId, type: 'heading', text: 'a' }, { id: sharedId, type: 'paragraph', text: 'b' }]],
      ['non-uuid id', [{ id: 'block-1', type: 'heading', text: 'x' }]],
      ['heading too long', [{ id: randomUUID(), type: 'heading', text: 'x'.repeat(201) }]],
      ['empty bullets', [{ id: randomUUID(), type: 'bullets', items: [] }]],
      ['bad image key', [{ id: randomUUID(), type: 'image', key: 'https://example.com/photo.jpg' }]],
      ['bad video id', [{ id: randomUUID(), type: 'video', provider: 'youtube', videoId: 'too-short' }]],
      ['wrong video provider', [{ id: randomUUID(), type: 'video', provider: 'vimeo', videoId: 'dQw4w9WgXcQ' }]],
      ['extra field on block', [{ id: randomUUID(), type: 'heading', text: 'x', extra: 1 }]],
    ];

    for (const [name, blocks] of invalidBlockSets) {
      const res = await createArticle(admin, categoryId, { blocks });
      expect(res.status, name).toBe(400);
    }
  });

  it('stamps the schema version and ignores a client-sent one', async () => {
    const admin = await adminSession();
    const category = await createCategory(admin);

    const created = await createArticle(admin, String(category.body.id), { schemaVersion: 99 });
    // schemaVersion is not an accepted field, so a client that sends it is a 400.
    expect(created.status).toBe(400);

    const clean = await createArticle(admin, String(category.body.id));
    expect(clean.body.schemaVersion).toBe(1);
  });

  it('rejects an article in a nonexistent category', async () => {
    const admin = await adminSession();
    const res = await createArticle(admin, randomUUID());
    expect(res.status).toBe(400);
  });
});

describe('optimistic concurrency', () => {
  it('rejects a stale update and accepts a retry after reload', async () => {
    const admin = await adminSession();
    const category = await createCategory(admin);
    const created = await createArticle(admin, String(category.body.id), { title: 'v1' });
    const id = String(created.body.id);
    const staleUpdatedAt = String(created.body.updatedAt);

    // First edit succeeds and moves updatedAt forward.
    const first = await app()
      .patch(`/api/v1/info/articles/${id}`)
      .set('Authorization', bearer(admin))
      .send({ title: 'v2', updatedAt: staleUpdatedAt });
    expect(first.status).toBe(200);
    expect(first.body.title).toBe('v2');
    expect(first.body.updatedAt).not.toBe(staleUpdatedAt);

    // Second edit with the original (now stale) updatedAt is refused.
    const stale = await app()
      .patch(`/api/v1/info/articles/${id}`)
      .set('Authorization', bearer(admin))
      .send({ title: 'v3', updatedAt: staleUpdatedAt });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('STALE_ARTICLE');

    // Reloading and retrying with the fresh updatedAt succeeds.
    const retry = await app()
      .patch(`/api/v1/info/articles/${id}`)
      .set('Authorization', bearer(admin))
      .send({ title: 'v3', updatedAt: String(first.body.updatedAt) });
    expect(retry.status).toBe(200);
    expect(retry.body.title).toBe('v3');
  });

  it('accepts a patch immediately after create, when updatedAt still equals createdAt', async () => {
    const admin = await adminSession();
    const category = await createCategory(admin);
    const created = await createArticle(admin, String(category.body.id));

    const res = await app()
      .patch(`/api/v1/info/articles/${String(created.body.id)}`)
      .set('Authorization', bearer(admin))
      .send({ status: 'draft', updatedAt: String(created.body.updatedAt) });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('draft');
  });

  it('requires updatedAt on every patch and at least one field to change', async () => {
    const admin = await adminSession();
    const category = await createCategory(admin);
    const created = await createArticle(admin, String(category.body.id));
    const id = String(created.body.id);

    const noVersion = await app()
      .patch(`/api/v1/info/articles/${id}`)
      .set('Authorization', bearer(admin))
      .send({ title: 'x' });
    expect(noVersion.status).toBe(400);

    const onlyVersion = await app()
      .patch(`/api/v1/info/articles/${id}`)
      .set('Authorization', bearer(admin))
      .send({ updatedAt: String(created.body.updatedAt) });
    expect(onlyVersion.status).toBe(400);
  });

  it('returns 404 for a patch or delete of an unknown article', async () => {
    const admin = await adminSession();
    const patch = await app()
      .patch(`/api/v1/info/articles/${randomUUID()}`)
      .set('Authorization', bearer(admin))
      .send({ title: 'x', updatedAt: '2026-07-17T16:30:00.000Z' });
    const del = await app().delete(`/api/v1/info/articles/${randomUUID()}`).set('Authorization', bearer(admin));

    expect(patch.status).toBe(404);
    expect(del.status).toBe(404);
  });
});
