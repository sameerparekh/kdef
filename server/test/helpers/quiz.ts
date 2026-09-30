import {
  AnswerResponse,
  NextResponse,
  Player,
  Round,
  type Emotion,
  type Question,
} from '@kdef/shared';
import type { TestContext } from './testApp.js';

export async function createPlayer(ctx: TestContext, displayName: string): Promise<Player> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/players',
    payload: { displayName },
  });
  if (res.statusCode !== 201) throw new Error(`create player failed: ${res.body}`);
  return Player.parse(res.json());
}

export async function startRound(ctx: TestContext, playerId: string): Promise<Round> {
  const res = await ctx.app.inject({ method: 'POST', url: `/api/players/${playerId}/rounds` });
  if (res.statusCode !== 201) throw new Error(`start round failed: ${res.body}`);
  return Round.parse(res.json());
}

export async function nextQuestion(
  ctx: TestContext,
  roundId: string,
): Promise<{ status: 'complete' } | { status: 'question'; question: Question }> {
  const res = await ctx.app.inject({ method: 'POST', url: `/api/rounds/${roundId}/next` });
  if (res.statusCode !== 200) throw new Error(`next failed: ${res.body}`);
  return NextResponse.parse(res.json());
}

/** The emotion of the photo shown for a question. Reads the DB; the API never leaks it. */
export async function actualEmotion(ctx: TestContext, questionId: string): Promise<Emotion> {
  const row = await ctx.testDb.db
    .selectFrom('questions')
    .innerJoin('images', 'images.id', 'questions.image_id')
    .innerJoin('emotions', 'emotions.id', 'images.emotion_id')
    .select('emotions.name')
    .where('questions.id', '=', questionId)
    .executeTakeFirstOrThrow();
  return row.name as Emotion;
}

export async function answer(
  ctx: TestContext,
  questionId: string,
  emotion: Emotion,
  clientElapsedMs?: number,
): Promise<AnswerResponse> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: `/api/questions/${questionId}/answer`,
    payload: clientElapsedMs === undefined ? { emotion } : { emotion, clientElapsedMs },
  });
  if (res.statusCode !== 200) throw new Error(`answer failed: ${res.statusCode} ${res.body}`);
  return AnswerResponse.parse(res.json());
}

/**
 * Play `count` questions for a player, starting new rounds as needed, advancing the test
 * clock `elapsedMs` (default 1s, which scores full points) per question. `choose` maps the actual emotion to the emotion the player picks.
 * The last round may be left unfinished.
 */
export async function play(
  ctx: TestContext,
  playerId: string,
  count: number,
  choose: (actual: Emotion) => Emotion,
  elapsedMs = 1000,
): Promise<void> {
  let played = 0;
  while (played < count) {
    const round = await startRound(ctx, playerId);
    for (let i = 0; i < round.length && played < count; i++) {
      const next = await nextQuestion(ctx, round.id);
      if (next.status !== 'question') throw new Error('round ended early');
      ctx.clock.advanceMs(elapsedMs);
      const actual = await actualEmotion(ctx, next.question.questionId);
      await answer(ctx, next.question.questionId, choose(actual));
      played++;
    }
  }
}
