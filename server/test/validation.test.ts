import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiError } from '@kdef/shared';
import { insertPool } from './helpers/images.js';
import { actualEmotion, createPlayer, nextQuestion, startRound } from './helpers/quiz.js';
import { createTestApp, type TestContext } from './helpers/testApp.js';

describe('request validation and races', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
    await insertPool(ctx.testDb.db, { subjects: 2, angles: ['frontal'] });
  });
  afterAll(async () => ctx.close());

  it('returns 400 for malformed ids on next, round summary and answer', async () => {
    const calls = [
      { method: 'POST', url: '/api/rounds/x/next' },
      { method: 'GET', url: '/api/rounds/x' },
      { method: 'POST', url: '/api/questions/x/answer', payload: { emotion: 'happy' } },
    ] as const;
    for (const c of calls) {
      const res = await ctx.app.inject(c);
      expect(res.statusCode).toBe(400);
      expect(ApiError.parse(res.json()).error).toBe('bad_request');
    }
  });

  it("passes Fastify's own client errors through as 4xx ApiErrors, never 500", async () => {
    const p = await createPlayer(ctx, 'Malformed');
    const round = await startRound(ctx, p.id);
    const empty = await ctx.app.inject({
      method: 'POST',
      url: `/api/rounds/${round.id}/next`,
      headers: { 'content-type': 'application/json' },
      payload: '',
    });
    expect(empty.statusCode).toBe(400);
    expect(ApiError.parse(empty.json()).error).toBe('bad_request');

    const next = await nextQuestion(ctx, round.id);
    if (next.status !== 'question') throw new Error('expected a question');
    const bad = await ctx.app.inject({
      method: 'POST',
      url: `/api/questions/${next.question.questionId}/answer`,
      headers: { 'content-type': 'application/json' },
      payload: '{bad',
    });
    expect(bad.statusCode).toBe(400);
    expect(ApiError.parse(bad.json()).error).toBe('bad_request');
  });

  it('accepts exactly one of two concurrent answers to the same question', async () => {
    const p = await createPlayer(ctx, 'Twice');
    const round = await startRound(ctx, p.id);
    const next = await nextQuestion(ctx, round.id);
    if (next.status !== 'question') throw new Error('expected a question');
    const actual = await actualEmotion(ctx, next.question.questionId);
    const send = () =>
      ctx.app.inject({
        method: 'POST',
        url: `/api/questions/${next.question.questionId}/answer`,
        payload: { emotion: actual },
      });
    const codes = (await Promise.all([send(), send()])).map((r) => r.statusCode).sort();
    expect(codes).toEqual([200, 409]);
  });
});
