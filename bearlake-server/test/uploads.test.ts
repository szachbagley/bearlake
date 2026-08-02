import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool } from '../src/db/pool.js';
import { resetRateLimits } from '../src/middleware/rateLimit.js';
import { generateImageKey, presignGet } from '../src/services/s3Service.js';
import { IMAGE_KEY_PATTERN } from '../src/schemas/articles.js';
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

/** Creates a category and an article, returning the article id. */
async function seedArticle(admin: Session): Promise<string> {
  const category = await app()
    .post('/api/v1/info/categories')
    .set('Authorization', bearer(admin))
    .send({ title: 'Pool & Hot Tub' });

  const article = await app()
    .post('/api/v1/info/articles')
    .set('Authorization', bearer(admin))
    .send({
      categoryId: String(category.body.id),
      title: 'Monitoring chemicals',
      status: 'draft',
      blocks: [{ id: randomUUID(), type: 'paragraph', text: 'draft' }],
    });

  return String(article.body.id);
}

function presign(session: Session, body: Record<string, unknown>) {
  return app().post('/api/v1/uploads/presign').set('Authorization', bearer(session)).send(body);
}

describe('authorization', () => {
  it('rejects a member and an anonymous caller', async () => {
    const admin = await adminSession();
    const member = await memberSession();
    const articleId = await seedArticle(admin);

    const asMember = await presign(member, {
      articleId,
      contentType: 'image/jpeg',
      contentLength: 1000,
    });
    expect(asMember.status).toBe(403);

    const anon = await app()
      .post('/api/v1/uploads/presign')
      .send({ articleId, contentType: 'image/jpeg', contentLength: 1000 });
    expect(anon.status).toBe(401);
  });
});

describe('POST /uploads/presign', () => {
  it('returns a namespaced key and a presigned PUT url for a valid request', async () => {
    const admin = await adminSession();
    const articleId = await seedArticle(admin);

    const res = await presign(admin, {
      articleId,
      contentType: 'image/jpeg',
      contentLength: 500_000,
    });

    expect(res.status).toBe(200);
    expect(res.body.key).toMatch(IMAGE_KEY_PATTERN);
    expect(res.body.key.startsWith(`articles/${articleId}/`)).toBe(true);
    expect(res.body.uploadUrl).toEqual(expect.any(String));
  });

  it('generates a unique key on every call', async () => {
    const admin = await adminSession();
    const articleId = await seedArticle(admin);

    const first = await presign(admin, { articleId, contentType: 'image/png', contentLength: 1000 });
    const second = await presign(admin, { articleId, contentType: 'image/png', contentLength: 1000 });

    expect(first.body.key).not.toBe(second.body.key);
  });

  it('signs the content type and length into the upload url', async () => {
    const admin = await adminSession();
    const articleId = await seedArticle(admin);

    const res = await presign(admin, {
      articleId,
      contentType: 'image/jpeg',
      contentLength: 12_345,
    });

    const url = new URL(res.body.uploadUrl as string);
    const signedHeaders = decodeURIComponent(url.searchParams.get('X-Amz-SignedHeaders') ?? '');
    // S3 will reject an upload whose type or size differs from what was signed.
    expect(signedHeaders).toContain('content-type');
    expect(signedHeaders).toContain('content-length');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('600');
    expect(url.searchParams.has('X-Amz-Signature')).toBe(true);
  });

  it('rejects a content type outside the allowlist', async () => {
    const admin = await adminSession();
    const articleId = await seedArticle(admin);

    for (const contentType of ['application/pdf', 'image/gif', 'text/plain', 'image/svg+xml']) {
      const res = await presign(admin, { articleId, contentType, contentLength: 1000 });
      expect(res.status, contentType).toBe(400);
    }
  });

  it('rejects an oversize image with 413', async () => {
    const admin = await adminSession();
    const articleId = await seedArticle(admin);

    const res = await presign(admin, {
      articleId,
      contentType: 'image/jpeg',
      contentLength: 10 * 1024 * 1024 + 1,
    });

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('rejects a non-positive or non-integer content length with 400', async () => {
    const admin = await adminSession();
    const articleId = await seedArticle(admin);

    for (const contentLength of [0, -1, 3.5]) {
      const res = await presign(admin, { articleId, contentType: 'image/jpeg', contentLength });
      expect(res.status, String(contentLength)).toBe(400);
    }
  });

  it('returns 404 for a nonexistent article', async () => {
    const admin = await adminSession();

    const res = await presign(admin, {
      articleId: randomUUID(),
      contentType: 'image/jpeg',
      contentLength: 1000,
    });

    expect(res.status).toBe(404);
  });

  it('rejects a malformed body and unknown fields', async () => {
    const admin = await adminSession();
    const articleId = await seedArticle(admin);

    const badId = await presign(admin, { articleId: 'nope', contentType: 'image/jpeg', contentLength: 1000 });
    expect(badId.status).toBe(400);

    const extra = await presign(admin, {
      articleId,
      contentType: 'image/jpeg',
      contentLength: 1000,
      acl: 'public-read',
    });
    expect(extra.status).toBe(400);
  });
});

describe('s3Service presigned GET (the image url resolver)', () => {
  it('produces a 15-minute presigned GET for a key', async () => {
    const key = generateImageKey(randomUUID());
    const url = new URL(await presignGet(key));

    expect(url.pathname).toContain(key);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(url.searchParams.has('X-Amz-Signature')).toBe(true);
  });
});
