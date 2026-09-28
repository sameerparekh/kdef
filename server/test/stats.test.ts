import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ANGLES, EMOTIONS, Leaderboard, PlayerStats, type Emotion } from '@kdef/shared';
import { insertPool } from './helpers/images.js';
import { createPlayer, play } from './helpers/quiz.js';
import { createTestApp, type TestContext } from './helpers/testApp.js';
import {
  LEADERBOARD_EMOTION_MIN_ANSWERS,
  LEADERBOARD_MIN_ANSWERS,
  LEADERBOARD_WINDOW,
} from '../src/stats/config.js';

const right = (a: Emotion) => a;
const wrong = (a: Emotion): Emotion => EMOTIONS[(EMOTIONS.indexOf(a) + 1) % EMOTIONS.length];

describe('GET /api/players/:id/stats', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
    await insertPool(ctx.testDb.db);
  });
  afterAll(async () => ctx.close());

  const getStats = async (id: string) => {
    const res = await ctx.app.inject({ method: 'GET', url: `/api/players/${id}/stats` });
    expect(res.statusCode).toBe(200);
    return PlayerStats.parse(res.json());
  };

  it('reports zeros (with null accuracy) for a player with no answers', async () => {
    const p = await createPlayer(ctx, 'Newbie');
    const s = await getStats(p.id);
    expect(s.player.id).toBe(p.id);
    expect(s.totalAnswered).toBe(0);
    expect(s.totalCorrect).toBe(0);
    expect(s.perEmotion.map((t) => t.emotion)).toEqual([...EMOTIONS]);
    expect(s.perAngle.map((t) => t.angle)).toEqual([...ANGLES]);
    for (const t of [...s.perEmotion, ...s.perAngle]) {
      expect(t).toMatchObject({ answered: 0, correct: 0, accuracy: null });
    }
    expect(s.confusion).toEqual([]);
    expect(s.recentRounds).toEqual([]);
  });

  it('aggregates per emotion, per angle, the confusion matrix and recent completed rounds', async () => {
    const p = await createPlayer(ctx, 'Ann');
    await play(ctx, p.id, 20, right); // round 1 complete, all correct
    await play(ctx, p.id, 20, wrong); // round 2 complete, all wrong
    await play(ctx, p.id, 7, right); // round 3 in progress
    const s = await getStats(p.id);

    expect(s.totalAnswered).toBe(47);
    expect(s.totalCorrect).toBe(27);
    expect(s.perEmotion.reduce((n, t) => n + t.answered, 0)).toBe(47);
    expect(s.perEmotion.reduce((n, t) => n + t.correct, 0)).toBe(27);
    expect(s.perAngle.reduce((n, t) => n + t.answered, 0)).toBe(47);
    expect(s.perAngle.reduce((n, t) => n + t.correct, 0)).toBe(27);
    for (const t of [...s.perEmotion, ...s.perAngle]) {
      expect(t.accuracy).toBe(t.answered === 0 ? null : t.correct / t.answered);
    }
    // 'unknown' angle has no photos in the pool
    expect(s.perAngle.find((t) => t.angle === 'unknown')?.answered).toBe(0);

    // Confusion is sparse and only holds the 20 misses, each off the diagonal.
    expect(s.confusion.reduce((n, c) => n + c.count, 0)).toBe(20);
    for (const c of s.confusion) {
      expect(c.count).toBeGreaterThan(0);
      expect(c.chosen).toBe(wrong(c.actual));
    }
    // Every cell's actual emotion agrees with the per-emotion miss count.
    for (const t of s.perEmotion) {
      const missed = s.confusion
        .filter((c) => c.actual === t.emotion)
        .reduce((n, c) => n + c.count, 0);
      expect(missed).toBe(t.answered - t.correct);
    }

    // Completed rounds only, newest first, with counts from the same module as the round summary.
    expect(s.recentRounds).toHaveLength(2);
    expect(s.recentRounds[0]).toMatchObject({ answered: 20, correct: 0 });
    expect(s.recentRounds[1]).toMatchObject({ answered: 20, correct: 20 });
    expect(new Date(s.recentRounds[0].startedAt).getTime()).toBeGreaterThan(
      new Date(s.recentRounds[1].startedAt).getTime(),
    );
  });

  it('keeps only the 10 most recent completed rounds', async () => {
    const p = await createPlayer(ctx, 'Marathon');
    for (let i = 0; i < 11; i++) await play(ctx, p.id, 20, i === 0 ? wrong : right);
    const s = await getStats(p.id);
    expect(s.recentRounds).toHaveLength(10);
    expect(s.recentRounds.every((r) => r.correct === 20)).toBe(true);
  });

  it('404s for an unknown player, 400 for a malformed id', async () => {
    const unknown = await ctx.app.inject({
      method: 'GET',
      url: '/api/players/00000000-0000-4000-8000-000000000000/stats',
    });
    expect(unknown.statusCode).toBe(404);
    const bad = await ctx.app.inject({ method: 'GET', url: '/api/players/x/stats' });
    expect(bad.statusCode).toBe(400);
  });
});

describe('GET /api/leaderboard', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp(7);
    await insertPool(ctx.testDb.db);
  });
  afterAll(async () => ctx.close());

  const getBoard = async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/leaderboard' });
    expect(res.statusCode).toBe(200);
    return Leaderboard.parse(res.json());
  };

  it('has no entries when there are no players', async () => {
    const board = await getBoard();
    expect(board.entries).toEqual([]);
    expect(board.windowSize).toBe(LEADERBOARD_WINDOW);
    expect(board.minAnswers).toBe(LEADERBOARD_MIN_ANSWERS);
  });

  it('ranks by accuracy over the last window of answers; unranked players follow with null rank', async () => {
    expect(LEADERBOARD_WINDOW).toBe(100);
    expect(LEADERBOARD_MIN_ANSWERS).toBe(40);
    const top = await createPlayer(ctx, 'Top');
    const twinA = await createPlayer(ctx, 'TwinA');
    const twinB = await createPlayer(ctx, 'TwinB');
    const mid = await createPlayer(ctx, 'Mid');
    const few = await createPlayer(ctx, 'Few');
    const none = await createPlayer(ctx, 'None');

    // Top: 20 old misses fall out of the window, then 100 hits.
    await play(ctx, top.id, 20, wrong);
    await play(ctx, top.id, LEADERBOARD_WINDOW, right);
    await play(ctx, twinA.id, LEADERBOARD_MIN_ANSWERS, right);
    await play(ctx, twinB.id, LEADERBOARD_MIN_ANSWERS, right);
    // Mid: fear always missed, everything else right.
    await play(ctx, mid.id, 60, (a) => (a === 'fear' ? 'sad' : a));
    await play(ctx, few.id, 3, right);

    const board = await getBoard();
    const byName = new Map(board.entries.map((e) => [e.player.displayName, e]));
    expect(board.entries.map((e) => e.player.displayName).slice(0, 4)).toEqual([
      'Top',
      'TwinA',
      'TwinB',
      'Mid',
    ]);

    const t = byName.get('Top')!;
    expect(t).toMatchObject({
      rank: 1,
      windowAnswered: LEADERBOARD_WINDOW,
      windowCorrect: LEADERBOARD_WINDOW,
      accuracy: 1,
      totalAnswered: LEADERBOARD_WINDOW + 20,
    });
    // Equal accuracy and equal answers share a rank; the next rank skips (competition ranking).
    expect(byName.get('TwinA')).toMatchObject({ rank: 2, accuracy: 1, windowAnswered: 40 });
    expect(byName.get('TwinB')).toMatchObject({ rank: 2, accuracy: 1, windowAnswered: 40 });
    const m = byName.get('Mid')!;
    expect(m.rank).toBe(4);
    expect(m.accuracy).toBe(m.windowCorrect / m.windowAnswered);
    expect(m.accuracy).toBeLessThan(1);
    expect(m.worstEmotion).toBe('fear');
    expect(m.bestEmotion).not.toBe('fear');
    expect(m.bestEmotion).not.toBeNull();

    // Unranked: fewer than minAnswers in the window. They come after ranked players.
    expect(byName.get('Few')).toMatchObject({ rank: null, windowAnswered: 3, totalAnswered: 3 });
    expect(byName.get('Few')?.accuracy).toBe(1);
    expect(byName.get('None')).toMatchObject({
      rank: null,
      windowAnswered: 0,
      accuracy: null,
      bestEmotion: null,
      worstEmotion: null,
    });
    expect(board.entries.slice(4).map((e) => e.player.displayName)).toEqual(['Few', 'None']);
    expect(board.entries.every((e) => (e.rank === null) === e.windowAnswered < 40)).toBe(true);
    void none;
  });

  it('leaves best and worst emotion null when no emotion has enough answers', async () => {
    const p = await createPlayer(ctx, 'Sparse');
    await play(ctx, p.id, LEADERBOARD_EMOTION_MIN_ANSWERS - 1, right);
    const e = (await getBoard()).entries.find((x) => x.player.id === p.id)!;
    expect(e.bestEmotion).toBeNull();
    expect(e.worstEmotion).toBeNull();
  });
});
