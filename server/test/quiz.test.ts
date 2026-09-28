import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiError, EMOTIONS, RoundSummary, type Emotion } from '@kdef/shared';
import { ROUND_LENGTH } from '../src/quiz/config.js';
import { insertImage, insertPool } from './helpers/images.js';
import {
  actualEmotion,
  answer,
  createPlayer,
  nextQuestion,
  play,
  startRound,
} from './helpers/quiz.js';
import { createTestApp, type TestContext } from './helpers/testApp.js';

const otherThan = (e: Emotion): Emotion => EMOTIONS[(EMOTIONS.indexOf(e) + 1) % EMOTIONS.length];

describe('rounds and questions', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
    await insertPool(ctx.testDb.db);
  });
  afterAll(async () => ctx.close());

  it('starts a round of ROUND_LENGTH questions', async () => {
    const p = await createPlayer(ctx, 'Starter');
    const round = await startRound(ctx, p.id);
    expect(ROUND_LENGTH).toBe(20);
    expect(round).toMatchObject({
      playerId: p.id,
      length: ROUND_LENGTH,
      endedAt: null,
      answered: 0,
      correct: 0,
      startedAt: ctx.clock.now().toISOString(),
    });
  });

  it('404s when starting a round for an unknown player, 400 for a malformed id', async () => {
    const unknown = await ctx.app.inject({
      method: 'POST',
      url: '/api/players/00000000-0000-4000-8000-000000000000/rounds',
    });
    expect(unknown.statusCode).toBe(404);
    const bad = await ctx.app.inject({ method: 'POST', url: '/api/players/x/rounds' });
    expect(bad.statusCode).toBe(400);
  });

  it('serves a question without leaking the emotion, and returns it again until answered', async () => {
    const p = await createPlayer(ctx, 'Resumer');
    const round = await startRound(ctx, p.id);
    const first = await nextQuestion(ctx, round.id);
    if (first.status !== 'question') throw new Error('expected a question');
    expect(first.question).toMatchObject({ position: 1, total: ROUND_LENGTH });
    expect(first.question.imageUrl).toMatch(/^\/api\/images\/[0-9a-f-]{36}$/);
    expect(Object.keys(first.question).sort()).toEqual(
      ['imageUrl', 'position', 'questionId', 'total'].sort(),
    );
    for (const e of EMOTIONS) expect(first.question.imageUrl).not.toContain(e);

    const again = await nextQuestion(ctx, round.id);
    expect(again).toEqual(first);
    const count = await ctx.testDb.db
      .selectFrom('questions')
      .select('id')
      .where('round_id', '=', round.id)
      .execute();
    expect(count).toHaveLength(1);

    const actual = await actualEmotion(ctx, first.question.questionId);
    await answer(ctx, first.question.questionId, actual);
    const second = await nextQuestion(ctx, round.id);
    if (second.status !== 'question') throw new Error('expected a question');
    expect(second.question.position).toBe(2);
    expect(second.question.questionId).not.toBe(first.question.questionId);
  });

  it('gives concurrent next calls the same question', async () => {
    const p = await createPlayer(ctx, 'Racer');
    const round = await startRound(ctx, p.id);
    const results = await Promise.all([1, 2, 3].map(() => nextQuestion(ctx, round.id)));
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
  });

  it('records a correct answer once, with response time from the injected clock', async () => {
    const p = await createPlayer(ctx, 'Timer');
    const round = await startRound(ctx, p.id);
    const next = await nextQuestion(ctx, round.id);
    if (next.status !== 'question') throw new Error('expected a question');
    const actual = await actualEmotion(ctx, next.question.questionId);
    ctx.clock.advanceMs(1500);
    const res = await answer(ctx, next.question.questionId, actual);
    expect(res).toEqual({
      correct: true,
      correctEmotion: actual,
      chosenEmotion: actual,
      contrastImageUrl: null,
      roundComplete: false,
    });
    const row = await ctx.testDb.db
      .selectFrom('questions')
      .select(['correct', 'response_ms', 'answered_at'])
      .where('id', '=', next.question.questionId)
      .executeTakeFirstOrThrow();
    expect(row.correct).toBe(true);
    expect(row.response_ms).toBe(1500);
    expect(row.answered_at).toEqual(ctx.clock.now());

    const twice = await ctx.app.inject({
      method: 'POST',
      url: `/api/questions/${next.question.questionId}/answer`,
      payload: { emotion: actual },
    });
    expect(twice.statusCode).toBe(409);
    expect(ApiError.parse(twice.json()).error).toBe('conflict');
  });

  it('records a miss, and offers a same-person contrast image of the chosen emotion', async () => {
    const p = await createPlayer(ctx, 'Misser');
    const round = await startRound(ctx, p.id);
    const next = await nextQuestion(ctx, round.id);
    if (next.status !== 'question') throw new Error('expected a question');
    const actual = await actualEmotion(ctx, next.question.questionId);
    const chosen = otherThan(actual);
    const res = await answer(ctx, next.question.questionId, chosen);
    expect(res).toMatchObject({ correct: false, correctEmotion: actual, chosenEmotion: chosen });
    expect(res.contrastImageUrl).toMatch(/^\/api\/images\/[0-9a-f-]{36}$/);

    const shown = await ctx.testDb.db
      .selectFrom('questions')
      .innerJoin('images', 'images.id', 'questions.image_id')
      .select(['images.subject_key', 'images.angle'])
      .where('questions.id', '=', next.question.questionId)
      .executeTakeFirstOrThrow();
    const contrast = await ctx.testDb.db
      .selectFrom('images')
      .innerJoin('emotions', 'emotions.id', 'images.emotion_id')
      .select(['images.subject_key', 'images.angle', 'emotions.name'])
      .where('images.id', '=', res.contrastImageUrl!.replace('/api/images/', ''))
      .executeTakeFirstOrThrow();
    expect(contrast.name).toBe(chosen);
    expect(contrast.subject_key).toBe(shown.subject_key);
    expect(contrast.angle).toBe(shown.angle);
  });

  it('404s for an unknown question, 400 for a bad emotion', async () => {
    const unknown = await ctx.app.inject({
      method: 'POST',
      url: '/api/questions/00000000-0000-4000-8000-000000000000/answer',
      payload: { emotion: 'happy' },
    });
    expect(unknown.statusCode).toBe(404);

    const p = await createPlayer(ctx, 'BadBody');
    const round = await startRound(ctx, p.id);
    const next = await nextQuestion(ctx, round.id);
    if (next.status !== 'question') throw new Error('expected a question');
    const bad = await ctx.app.inject({
      method: 'POST',
      url: `/api/questions/${next.question.questionId}/answer`,
      payload: { emotion: 'confused' },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('completes a round after ROUND_LENGTH answers and summarises it', async () => {
    const p = await createPlayer(ctx, 'Finisher');
    const round = await startRound(ctx, p.id);
    let lastResponse;
    for (let i = 0; i < ROUND_LENGTH; i++) {
      const next = await nextQuestion(ctx, round.id);
      if (next.status !== 'question') throw new Error('round ended early');
      expect(next.question.position).toBe(i + 1);
      ctx.clock.advanceMs(1000);
      const actual = await actualEmotion(ctx, next.question.questionId);
      lastResponse = await answer(
        ctx,
        next.question.questionId,
        i < 5 ? otherThan(actual) : actual,
      );
      expect(lastResponse.roundComplete).toBe(i === ROUND_LENGTH - 1);
    }
    expect(lastResponse?.roundComplete).toBe(true);
    expect(await nextQuestion(ctx, round.id)).toEqual({ status: 'complete' });

    const res = await ctx.app.inject({ method: 'GET', url: `/api/rounds/${round.id}` });
    expect(res.statusCode).toBe(200);
    const summary = RoundSummary.parse(res.json());
    expect(summary.round).toMatchObject({
      id: round.id,
      answered: ROUND_LENGTH,
      correct: ROUND_LENGTH - 5,
      endedAt: ctx.clock.now().toISOString(),
    });
    expect(summary.perEmotion.map((t) => t.emotion)).toEqual([...EMOTIONS]);
    expect(summary.perEmotion.reduce((n, t) => n + t.answered, 0)).toBe(ROUND_LENGTH);
    expect(summary.perEmotion.reduce((n, t) => n + t.correct, 0)).toBe(ROUND_LENGTH - 5);
    for (const t of summary.perEmotion) {
      expect(t.accuracy).toBe(t.answered === 0 ? null : t.correct / t.answered);
    }
  });

  it('404s for an unknown round', async () => {
    for (const [method, suffix] of [
      ['GET', ''],
      ['POST', '/next'],
    ] as const) {
      const res = await ctx.app.inject({
        method,
        url: `/api/rounds/00000000-0000-4000-8000-000000000000${suffix}`,
      });
      expect(res.statusCode).toBe(404);
    }
  });

  it('adapts: a player who always misses fear sees it more than a fresh player does', async () => {
    const fresh = await createPlayer(ctx, 'Fresh');
    const weak = await createPlayer(ctx, 'FearMisser');
    await play(ctx, fresh.id, 120, (a) => a);
    await play(ctx, weak.id, 120, (a) => (a === 'fear' ? 'sad' : a));
    const fearShare = async (playerId: string) => {
      const rows = await ctx.testDb.db
        .selectFrom('questions')
        .innerJoin('images', 'images.id', 'questions.image_id')
        .innerJoin('emotions', 'emotions.id', 'images.emotion_id')
        .select('emotions.name')
        .where('questions.player_id', '=', playerId)
        .execute();
      return rows.filter((r) => r.name === 'fear').length / rows.length;
    };
    expect(await fearShare(weak.id)).toBeGreaterThan((await fearShare(fresh.id)) + 0.15);
  });
});

describe('contrast image choice', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => ctx.close());

  /** Insert a question for a photo directly, so the shown photo is known. */
  async function seedQuestion(imageId: string): Promise<string> {
    const db = ctx.testDb.db;
    const player = await db
      .insertInto('players')
      .values({
        display_name: `p${imageId}`,
        color: '#000000',
        created_at: ctx.clock.now(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const round = await db
      .insertInto('rounds')
      .values({ player_id: player.id, length: 20, started_at: ctx.clock.now() })
      .returning('id')
      .executeTakeFirstOrThrow();
    const q = await db
      .insertInto('questions')
      .values({
        round_id: round.id,
        player_id: player.id,
        position: 1,
        image_id: imageId,
        asked_at: ctx.clock.now(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return q.id;
  }

  it('prefers the same subject and angle, else any angle of that emotion, else null', async () => {
    const db = ctx.testDb.db;
    const shownHappy = await insertImage(db, {
      emotion: 'happy',
      subjectKey: 7,
      angle: 'half_left',
    });
    const sadSameAngle = await insertImage(db, {
      emotion: 'sad',
      subjectKey: 7,
      angle: 'half_left',
    });
    await insertImage(db, { emotion: 'sad', subjectKey: 7, angle: 'frontal' });
    await insertImage(db, { emotion: 'sad', subjectKey: 8, angle: 'half_left' });
    const q1 = await seedQuestion(shownHappy);
    const r1 = await answer(ctx, q1, 'sad');
    expect(r1.contrastImageUrl).toBe(`/api/images/${sadSameAngle}`);

    const shownFrontalFear = await insertImage(db, {
      emotion: 'fear',
      subjectKey: 9,
      angle: 'frontal',
    });
    const angrySubject9 = await insertImage(db, {
      emotion: 'angry',
      subjectKey: 9,
      angle: 'half_right',
    });
    const q2 = await seedQuestion(shownFrontalFear);
    const r2 = await answer(ctx, q2, 'angry');
    expect(r2.contrastImageUrl).toBe(`/api/images/${angrySubject9}`);

    const q3 = await seedQuestion(shownFrontalFear);
    const r3 = await answer(ctx, q3, 'disgust');
    expect(r3.contrastImageUrl).toBeNull();
    expect(r3.correct).toBe(false);
  });
});

describe('an empty image table', () => {
  it('fails loudly (503) rather than serving an empty quiz', async () => {
    const ctx = await createTestApp();
    try {
      const p = await createPlayer(ctx, 'Lonely');
      const round = await startRound(ctx, p.id);
      const res = await ctx.app.inject({ method: 'POST', url: `/api/rounds/${round.id}/next` });
      expect(res.statusCode).toBe(503);
      expect(ApiError.parse(res.json()).error).toBe('no_images');
    } finally {
      await ctx.close();
    }
  });
});
