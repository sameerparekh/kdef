import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EMOTIONS, RoundSummary, pointsFor, type Emotion } from '@kdef/shared';
import { backfillPoints } from '../src/scoring/backfill.js';
import { insertPool } from './helpers/images.js';
import {
  actualEmotion,
  answer,
  createPlayer,
  nextQuestion,
  play,
  startRound,
} from './helpers/quiz.js';
import { createTestApp, type TestContext } from './helpers/testApp.js';

const wrong = (a: Emotion): Emotion => EMOTIONS[(EMOTIONS.indexOf(a) + 1) % EMOTIONS.length]!;

describe('speed scoring through the answer route', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
    await insertPool(ctx.testDb.db);
  });
  afterAll(async () => ctx.close());
  beforeEach(async () => {
    await ctx.testDb.db.deleteFrom('questions').execute();
  });

  /** Ask a question, let `serverMs` pass, answer it, and return the stored row. */
  async function answerAfter(
    playerId: string,
    serverMs: number,
    opts: { correct?: boolean; clientElapsedMs?: number } = {},
  ) {
    const round = await startRound(ctx, playerId);
    const next = await nextQuestion(ctx, round.id);
    if (next.status !== 'question') throw new Error('expected a question');
    const actual = await actualEmotion(ctx, next.question.questionId);
    ctx.clock.advanceMs(serverMs);
    const res = await answer(
      ctx,
      next.question.questionId,
      opts.correct === false ? wrong(actual) : actual,
      opts.clientElapsedMs,
    );
    const row = await ctx.testDb.db
      .selectFrom('questions')
      .select(['points', 'response_ms', 'client_elapsed_ms'])
      .where('id', '=', next.question.questionId)
      .executeTakeFirstOrThrow();
    return { res, row, round };
  }

  it('scores by server time when the client sends no elapsed time', async () => {
    const p = await createPlayer(ctx, 'NoClient');
    const { res, row } = await answerAfter(p.id, 5000);
    expect(res.points).toBe(50);
    expect(row).toEqual({ points: 50, response_ms: 5000, client_elapsed_ms: null });
  });

  it('uses a smaller client time within the load allowance, keeping the server time raw', async () => {
    const p = await createPlayer(ctx, 'FastClient');
    const { res, row } = await answerAfter(p.id, 9000, { clientElapsedMs: 8000 });
    // Scored on 8000 ms: 100 * 2^(-7000/4000) = 29.7 -> 30.
    expect(res.points).toBe(30);
    expect(row).toEqual({ points: 30, response_ms: 9000, client_elapsed_ms: 8000 });
  });

  it('cannot score below the load-allowance floor with clientElapsedMs 0', async () => {
    const p = await createPlayer(ctx, 'Zero');
    const { res, row } = await answerAfter(p.id, 9000, { clientElapsedMs: 0 });
    // Floor is 9000 - 2000 = 7000 ms: 100 * 2^(-6000/4000) = 35.4 -> 35, not 100.
    expect(res.points).toBe(35);
    expect(row).toEqual({ points: 35, response_ms: 9000, client_elapsed_ms: 0 });
  });

  it('ignores a client elapsed time larger than the server measured', async () => {
    const p = await createPlayer(ctx, 'Cheat');
    const { res, row } = await answerAfter(p.id, 3000, { clientElapsedMs: 60_000 });
    // 100 * 2^(-2000/4000) = 70.7 -> 71, from the server's 3000 ms.
    expect(res.points).toBe(71);
    expect(row).toEqual({ points: 71, response_ms: 3000, client_elapsed_ms: 60_000 });
  });

  it('rejects a negative, fractional or absurdly large client elapsed time with a 400', async () => {
    const p = await createPlayer(ctx, 'Negative');
    const round = await startRound(ctx, p.id);
    const next = await nextQuestion(ctx, round.id);
    if (next.status !== 'question') throw new Error('expected a question');
    // 3e9 would overflow the integer column (22003) if it got past validation.
    for (const clientElapsedMs of [-5, 12.5, 3_000_000_000]) {
      const res = await ctx.app.inject({
        method: 'POST',
        url: `/api/questions/${next.question.questionId}/answer`,
        payload: { emotion: 'happy', clientElapsedMs },
      });
      expect(res.statusCode).toBe(400);
    }
  });

  it('scores a miss 0 however fast, and stores it', async () => {
    const p = await createPlayer(ctx, 'Miss');
    const { res, row } = await answerAfter(p.id, 100, { correct: false, clientElapsedMs: 0 });
    expect(res.correct).toBe(false);
    expect(res.points).toBe(0);
    expect(row.points).toBe(0);
  });

  it('gives a very slow correct answer the minimum of 1 point', async () => {
    const p = await createPlayer(ctx, 'Slow');
    const { res, row } = await answerAfter(p.id, 10 * 60 * 1000);
    expect(res.points).toBe(1);
    expect(row.points).toBe(1);
  });

  it('rejects a non-numeric clientElapsedMs', async () => {
    const p = await createPlayer(ctx, 'Bad');
    const round = await startRound(ctx, p.id);
    const next = await nextQuestion(ctx, round.id);
    if (next.status !== 'question') throw new Error('expected a question');
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/questions/${next.question.questionId}/answer`,
      payload: { emotion: 'happy', clientElapsedMs: 'soon' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('totals points on the round and its summary, from the stored answers', async () => {
    const p = await createPlayer(ctx, 'Totals');
    const round = await startRound(ctx, p.id);
    expect(round.points).toBe(0);
    const times: [number, boolean][] = [
      [1000, true], // 100
      [3000, true], // 71
      [500, false], // 0
    ];
    for (const [ms, correct] of times) {
      const next = await nextQuestion(ctx, round.id);
      if (next.status !== 'question') throw new Error('expected a question');
      const actual = await actualEmotion(ctx, next.question.questionId);
      ctx.clock.advanceMs(ms);
      await answer(ctx, next.question.questionId, correct ? actual : wrong(actual));
    }
    const res = await ctx.app.inject({ method: 'GET', url: `/api/rounds/${round.id}` });
    const summary = RoundSummary.parse(res.json());
    expect(summary.round.points).toBe(171);
    expect(summary.points).toBe(171);
    expect(summary.round).toMatchObject({ answered: 3, correct: 2 });
  });
});

describe('backfillPoints', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
    await insertPool(ctx.testDb.db);
  });
  afterAll(async () => ctx.close());

  it('fills points for answered rows from response_ms with the one formula, and is idempotent', async () => {
    const db = ctx.testDb.db;
    const p = await createPlayer(ctx, 'Old');
    let i = 0;
    await play(ctx, p.id, 10, (a) => (i++ % 3 === 0 ? wrong(a) : a));
    // One open (unanswered) question: it must stay null.
    const round = await startRound(ctx, p.id);
    await nextQuestion(ctx, round.id);

    // Simulate rows answered before the points column existed.
    await db
      .updateTable('questions')
      .set({ points: null })
      .where('answered_at', 'is not', null)
      .execute();
    const answered = await db
      .selectFrom('questions')
      .select('id')
      .where('answered_at', 'is not', null)
      .orderBy('asked_at')
      .orderBy('position')
      .execute();
    for (const [n, q] of answered.entries()) {
      await db
        .updateTable('questions')
        .set({ response_ms: n * 1700 })
        .where('id', '=', q.id)
        .execute();
    }

    expect(await backfillPoints(db)).toBe(10);

    const rows = await db
      .selectFrom('questions')
      .select(['correct', 'response_ms', 'points', 'answered_at'])
      .orderBy('asked_at')
      .execute();
    for (const r of rows) {
      if (r.answered_at === null) expect(r.points).toBeNull();
      else expect(r.points).toBe(pointsFor(r.correct!, r.response_ms!));
    }
    // Hand-computed spot checks. The first answer (0 ms) was a miss (i % 3 === 0); the second
    // (1700 ms) was a hit: 100 * 2^(-700/4000) = 88.6 -> 89.
    const byMs = new Map(rows.filter((r) => r.answered_at).map((r) => [r.response_ms, r]));
    expect(byMs.get(0)?.points).toBe(0);
    expect(byMs.get(1700)?.points).toBe(89);

    // Idempotent: a second run touches nothing, even if a stored value differs.
    await db.updateTable('questions').set({ points: 7 }).where('response_ms', '=', 1700).execute();
    expect(await backfillPoints(db)).toBe(0);
    const kept = await db
      .selectFrom('questions')
      .select('points')
      .where('response_ms', '=', 1700)
      .executeTakeFirstOrThrow();
    expect(kept.points).toBe(7);
  });

  it('does nothing on an empty table', async () => {
    const empty = await createTestApp();
    try {
      expect(await backfillPoints(empty.testDb.db)).toBe(0);
    } finally {
      await empty.close();
    }
  });
});
