import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiError, PLAYER_COLORS, Player, PlayerList } from '@kdef/shared';
import { insertPool } from './helpers/images.js';
import { createPlayer, nextQuestion, startRound } from './helpers/quiz.js';
import { createTestApp, type TestContext } from './helpers/testApp.js';

describe('players API', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => ctx.close());

  it('creates a player with a palette color and lists players in creation order', async () => {
    const a = await createPlayer(ctx, 'Zed');
    ctx.clock.advanceMs(1000);
    const b = await createPlayer(ctx, 'Amy');
    expect(PLAYER_COLORS).toContain(a.color);
    expect(PLAYER_COLORS).toContain(b.color);
    const res = await ctx.app.inject({ method: 'GET', url: '/api/players' });
    expect(res.statusCode).toBe(200);
    const names = PlayerList.parse(res.json()).players.map((p) => p.displayName);
    expect(names.slice(0, 2)).toEqual(['Zed', 'Amy']);
  });

  it('uses the requested color and the injected clock for createdAt', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/players',
      payload: { displayName: 'Colorful', color: '#123abc' },
    });
    expect(res.statusCode).toBe(201);
    const p = Player.parse(res.json());
    expect(p.color).toBe('#123abc');
    expect(p.createdAt).toBe(ctx.clock.now().toISOString());
  });

  it('rejects a duplicate name case-insensitively with 409', async () => {
    await createPlayer(ctx, 'Dupe');
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/players',
      payload: { displayName: 'dUPE' },
    });
    expect(res.statusCode).toBe(409);
    expect(ApiError.parse(res.json()).error).toBe('conflict');
  });

  it('rejects invalid bodies with 400', async () => {
    for (const payload of [{}, { displayName: '   ' }, { displayName: 'x', color: 'red' }]) {
      const res = await ctx.app.inject({ method: 'POST', url: '/api/players', payload });
      expect(res.statusCode).toBe(400);
    }
  });

  it('deletes a player with 204, cascading rounds and questions, and 404s afterwards', async () => {
    await insertPool(ctx.testDb.db, { subjects: 1, angles: ['frontal'] });
    const p = await createPlayer(ctx, 'Doomed');
    const round = await startRound(ctx, p.id);
    await nextQuestion(ctx, round.id);
    const del = await ctx.app.inject({ method: 'DELETE', url: `/api/players/${p.id}` });
    expect(del.statusCode).toBe(204);
    const rounds = await ctx.testDb.db
      .selectFrom('rounds')
      .select('id')
      .where('player_id', '=', p.id)
      .execute();
    const questions = await ctx.testDb.db
      .selectFrom('questions')
      .select('id')
      .where('player_id', '=', p.id)
      .execute();
    expect(rounds).toEqual([]);
    expect(questions).toEqual([]);
    const again = await ctx.app.inject({ method: 'DELETE', url: `/api/players/${p.id}` });
    expect(again.statusCode).toBe(404);
  });

  it('returns 400 for a malformed id and 404 for an unknown one', async () => {
    const bad = await ctx.app.inject({ method: 'DELETE', url: '/api/players/not-a-uuid' });
    expect(bad.statusCode).toBe(400);
    const unknown = await ctx.app.inject({
      method: 'DELETE',
      url: '/api/players/00000000-0000-4000-8000-000000000000',
    });
    expect(unknown.statusCode).toBe(404);
  });
});
