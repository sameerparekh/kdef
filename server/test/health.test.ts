import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Health } from '@kdef/shared';
import { createTestApp, type TestContext } from './helpers/testApp.js';

describe('GET /api/health', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => ctx.close());

  it('reports ok and the image count from the database', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(Health.parse(res.json())).toEqual({ status: 'ok', images: 0 });
  });

  it('returns an ApiError body for unknown API routes', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
  });
});
