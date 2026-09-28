import { sql } from 'kysely';
import {
  EMOTIONS,
  type Angle,
  type AnswerResponse,
  type Emotion,
  type NextResponse,
  type Round,
} from '@kdef/shared';
import {
  RECENT_IMAGE_EXCLUSION,
  RECENT_SUBJECT_AVOIDANCE,
  EMOTION_HISTORY_WINDOW,
} from '../adaptive/config.js';
import {
  pickEmotionAndTier,
  pickImage,
  pickUniform,
  type AnswerRecord,
  type Candidate,
} from '../adaptive/picker.js';
import type { AppDeps } from '../app.js';
import type { Db } from '../db/connect.js';
import { HttpError, conflict, notFound } from '../errors.js';
import { toRound } from '../stats/stats.js';
import { ROUND_LENGTH } from './config.js';

export const imageUrl = (imageId: string) => `/api/images/${imageId}`;

export async function startRound({ db, clock }: AppDeps, playerId: string): Promise<Round> {
  const player = await db
    .selectFrom('players')
    .select('id')
    .where('id', '=', playerId)
    .executeTakeFirst();
  if (!player) throw notFound('Player');
  const row = await db
    .insertInto('rounds')
    .values({ player_id: playerId, length: ROUND_LENGTH, started_at: clock.now() })
    .returningAll()
    .executeTakeFirstOrThrow();
  return toRound(db, row);
}

/** The player's answered questions, newest first, at most EMOTION_HISTORY_WINDOW per emotion. */
async function loadHistory(db: Db, playerId: string): Promise<AnswerRecord[]> {
  const { rows } = await sql<{ emotion: Emotion; angle: Angle; correct: boolean }>`
    SELECT emotion, angle, correct FROM (
      SELECT e.name AS emotion, i.angle, q.correct, q.answered_at, q.id,
        row_number() OVER (PARTITION BY i.emotion_id ORDER BY q.answered_at DESC, q.id) AS rn
      FROM questions q
      JOIN images i ON i.id = q.image_id
      JOIN emotions e ON e.id = i.emotion_id
      WHERE q.player_id = ${playerId} AND q.answered_at IS NOT NULL
    ) t
    WHERE rn <= ${EMOTION_HISTORY_WINDOW}
    ORDER BY answered_at DESC, id`.execute(db);
  return rows;
}

export async function nextQuestion(
  { db, clock, rng }: AppDeps,
  roundId: string,
): Promise<NextResponse> {
  return db.transaction().execute(async (trx): Promise<NextResponse> => {
    // Serialises concurrent /next calls for the same round.
    const round = await trx
      .selectFrom('rounds')
      .selectAll()
      .where('id', '=', roundId)
      .forUpdate()
      .executeTakeFirst();
    if (!round) throw notFound('Round');

    const open = await trx
      .selectFrom('questions')
      .select(['id', 'image_id', 'position'])
      .where('round_id', '=', roundId)
      .where('answered_at', 'is', null)
      .executeTakeFirst();
    if (open) {
      return {
        status: 'question',
        question: {
          questionId: open.id,
          imageUrl: imageUrl(open.image_id),
          position: open.position,
          total: round.length,
        },
      };
    }

    const { answered } = await trx
      .selectFrom('questions')
      .select(sql<string>`count(*)`.as('answered'))
      .where('round_id', '=', roundId)
      .executeTakeFirstOrThrow();
    const answeredCount = Number(answered);
    if (answeredCount >= round.length) return { status: 'complete' };

    const available = (
      await trx
        .selectFrom('images as i')
        .innerJoin('emotions as e', 'e.id', 'i.emotion_id')
        .select('e.name')
        .distinct()
        .execute()
    )
      .map((r) => r.name as Emotion)
      .sort((a, b) => EMOTIONS.indexOf(a) - EMOTIONS.indexOf(b));
    if (available.length === 0) {
      throw new HttpError(503, 'no_images', 'There are no images to quiz on');
    }

    const history = await loadHistory(trx, round.player_id);
    const { emotion, tier } = pickEmotionAndTier(history, rng, available);

    const candidates: (Candidate & { emotionId: number })[] = (
      await trx
        .selectFrom('images as i')
        .innerJoin('emotions as e', 'e.id', 'i.emotion_id')
        .leftJoin('questions as q', (join) =>
          join.onRef('q.image_id', '=', 'i.id').on('q.player_id', '=', round.player_id),
        )
        .select([
          'i.id',
          'i.angle',
          'i.subject_key',
          'i.emotion_id',
          sql<string>`count(q.id)`.as('times_seen'),
        ])
        .where('e.name', '=', emotion)
        .groupBy('i.id')
        .execute()
    ).map((r) => ({
      id: r.id,
      angle: r.angle,
      subjectKey: r.subject_key,
      emotionId: r.emotion_id,
      timesSeen: Number(r.times_seen),
    }));

    const recent = await trx
      .selectFrom('questions as q')
      .innerJoin('images as i', 'i.id', 'q.image_id')
      .select(['q.image_id', 'i.subject_key'])
      .where('q.player_id', '=', round.player_id)
      .orderBy('q.asked_at', 'desc')
      .orderBy('q.position', 'desc')
      .limit(RECENT_IMAGE_EXCLUSION)
      .execute();

    const picked = pickImage({
      candidates,
      tier,
      recentImageIds: recent.map((r) => r.image_id),
      recentSubjectKeys: recent.slice(0, RECENT_SUBJECT_AVOIDANCE).map((r) => r.subject_key),
      rng,
    });
    if (!picked) throw new HttpError(503, 'no_images', `There are no ${emotion} images to quiz on`);

    const position = answeredCount + 1;
    const q = await trx
      .insertInto('questions')
      .values({
        round_id: roundId,
        player_id: round.player_id,
        position,
        image_id: picked.id,
        asked_at: clock.now(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return {
      status: 'question',
      question: {
        questionId: q.id,
        imageUrl: imageUrl(picked.id),
        position,
        total: round.length,
      },
    };
  });
}

export async function answerQuestion(
  { db, clock, rng }: AppDeps,
  questionId: string,
  chosen: Emotion,
): Promise<AnswerResponse> {
  return db.transaction().execute(async (trx): Promise<AnswerResponse> => {
    const q = await trx
      .selectFrom('questions')
      .selectAll()
      .where('id', '=', questionId)
      .forUpdate()
      .executeTakeFirst();
    if (!q) throw notFound('Question');
    if (q.answered_at !== null) throw conflict('This question has already been answered');

    const shown = await trx
      .selectFrom('images as i')
      .innerJoin('emotions as e', 'e.id', 'i.emotion_id')
      .select(['e.name', 'i.subject_key', 'i.angle'])
      .where('i.id', '=', q.image_id)
      .executeTakeFirstOrThrow();
    const chosenRow = await trx
      .selectFrom('emotions')
      .select('id')
      .where('name', '=', chosen)
      .executeTakeFirstOrThrow();

    // The one place correctness is decided; it is stored and never re-derived.
    const correct = shown.name === chosen;
    const now = clock.now();
    await trx
      .updateTable('questions')
      .set({
        answered_at: now,
        chosen_emotion_id: chosenRow.id,
        correct,
        response_ms: Math.max(0, now.getTime() - q.asked_at.getTime()),
      })
      .where('id', '=', questionId)
      .execute();

    // Round lock: complete once `length` questions are answered.
    const round = await trx
      .selectFrom('rounds')
      .selectAll()
      .where('id', '=', q.round_id)
      .forUpdate()
      .executeTakeFirstOrThrow();
    const { answered } = await trx
      .selectFrom('questions')
      .select(sql<string>`count(*)`.as('answered'))
      .where('round_id', '=', q.round_id)
      .where('answered_at', 'is not', null)
      .executeTakeFirstOrThrow();
    const roundComplete = Number(answered) >= round.length;
    if (roundComplete && round.ended_at === null) {
      await trx.updateTable('rounds').set({ ended_at: now }).where('id', '=', round.id).execute();
    }

    let contrastImageUrl: string | null = null;
    if (!correct) {
      const options = await trx
        .selectFrom('images')
        .select(['id', 'angle'])
        .where('subject_key', '=', shown.subject_key)
        .where('emotion_id', '=', chosenRow.id)
        .execute();
      const sameAngle = options.filter((o) => o.angle === shown.angle);
      const pool = sameAngle.length > 0 ? sameAngle : options;
      if (pool.length > 0) {
        const pick = pickUniform(pool, rng);
        contrastImageUrl = pick ? imageUrl(pick.id) : null;
      }
    }

    return {
      correct,
      correctEmotion: shown.name as Emotion,
      chosenEmotion: chosen,
      contrastImageUrl,
      roundComplete,
    };
  });
}
