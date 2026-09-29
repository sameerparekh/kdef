import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RECENT_IMAGE_EXCLUSION } from '../src/adaptive/config.js';
import { insertImage } from './helpers/images.js';
import { createPlayer, nextQuestion, play, startRound } from './helpers/quiz.js';
import { createTestApp, type TestContext } from './helpers/testApp.js';

/** Image-selection wiring: the SQL that feeds the pure picker (times seen, recent shown, subjects). */
describe('image selection through the API', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => ctx.close());

  it("rotates through the least-seen images, counting only this player's views", async () => {
    for (let s = 1; s <= 4; s++) {
      await insertImage(ctx.testDb.db, { emotion: 'happy', subjectKey: 100 + s });
    }
    const other = await createPlayer(ctx, 'Other');
    await play(ctx, other.id, 3, (a) => a); // another player's views must not count
    const me = await createPlayer(ctx, 'Rotator');
    await play(ctx, me.id, 8, (a) => a);
    const shown = (
      await ctx.testDb.db
        .selectFrom('questions')
        .select('image_id')
        .where('player_id', '=', me.id)
        .orderBy('asked_at')
        .execute()
    ).map((r) => r.image_id);
    expect(new Set(shown.slice(0, 4)).size).toBe(4);
    expect(new Set(shown.slice(4)).size).toBe(4);
  });
});

describe('recent-image exclusion and subject avoidance through the API', () => {
  it('after every photo was seen once, the next one comes from outside the last 50 shown', async () => {
    const ctx = await createTestApp();
    try {
      const total = RECENT_IMAGE_EXCLUSION + 5;
      for (let s = 1; s <= total; s++) {
        await insertImage(ctx.testDb.db, { emotion: 'happy', subjectKey: s });
      }
      const p = await createPlayer(ctx, 'Exclude');
      await play(ctx, p.id, total, (a) => a);
      const round = await startRound(ctx, p.id);
      const next = await nextQuestion(ctx, round.id);
      if (next.status !== 'question') throw new Error('expected a question');
      const rows = await ctx.testDb.db
        .selectFrom('questions')
        .select(['image_id', 'round_id'])
        .where('player_id', '=', p.id)
        .orderBy('asked_at')
        .execute();
      const previous = rows.filter((r) => r.round_id !== round.id).map((r) => r.image_id);
      const newest = rows.find((r) => r.round_id === round.id)?.image_id;
      expect(previous).toHaveLength(total);
      // Everything is equally seen, so only the exclusion decides: the pick is one of the
      // 5 photos shown longest ago.
      expect(previous.slice(0, total - RECENT_IMAGE_EXCLUSION)).toContain(newest);
    } finally {
      await ctx.close();
    }
  });

  it('avoids the subjects of the last few questions when photos are equally unseen', async () => {
    const ctx = await createTestApp(3);
    try {
      for (let s = 1; s <= 3; s++) {
        for (const angle of ['frontal', 'unknown'] as const) {
          await insertImage(ctx.testDb.db, { emotion: 'happy', subjectKey: s, angle });
        }
      }
      for (let i = 0; i < 8; i++) {
        const p = await createPlayer(ctx, `Subject${i}`);
        await play(ctx, p.id, 3, (a) => a);
        const subjects = (
          await ctx.testDb.db
            .selectFrom('questions as q')
            .innerJoin('images as im', 'im.id', 'q.image_id')
            .select('im.subject_key')
            .where('q.player_id', '=', p.id)
            .orderBy('q.asked_at')
            .execute()
        ).map((r) => r.subject_key);
        expect(new Set(subjects).size).toBe(3);
      }
    } finally {
      await ctx.close();
    }
  });
});
