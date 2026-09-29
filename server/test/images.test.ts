import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertImage } from './helpers/images.js';
import { createTestApp, type TestContext } from './helpers/testApp.js';

describe('GET /api/images/:id', () => {
  let ctx: TestContext;
  let id: string;
  const content = Buffer.from('not really a jpeg');
  const sha = createHash('sha256').update(content).digest('hex');

  beforeAll(async () => {
    ctx = await createTestApp();
    id = await insertImage(ctx.testDb.db, {
      emotion: 'happy',
      subjectKey: 1,
      content,
      contentType: 'image/jpeg',
    });
  });
  afterAll(async () => ctx.close());

  it('serves the bytes with content type, sha256 ETag and immutable caching', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: `/api/images/${id}` });
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.equals(content)).toBe(true);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers.etag).toBe(`"${sha}"`);
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('answers 304 when If-None-Match matches', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/images/${id}`,
      headers: { 'if-none-match': `"${sha}"` },
    });
    expect(res.statusCode).toBe(304);
    expect(res.headers.etag).toBe(`"${sha}"`);
    expect(res.rawPayload.length).toBe(0);
  });

  it('serves the bytes when If-None-Match does not match', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/images/${id}`,
      headers: { 'if-none-match': '"something-else"' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('returns 404 for unknown and malformed ids, never 500', async () => {
    for (const bad of ['00000000-0000-4000-8000-000000000000', 'nope', '123']) {
      const res = await ctx.app.inject({ method: 'GET', url: `/api/images/${bad}` });
      expect(res.statusCode).toBe(404);
    }
  });
});
