import { sql, type Selectable } from 'kysely';
import {
  ANGLES,
  EMOTIONS,
  type AngleTally,
  type ConfusionCell,
  type Emotion,
  type EmotionTally,
  type Leaderboard,
  type LeaderboardEntry,
  type Player,
  type PlayerStats,
  type Round,
} from '@kdef/shared';
import type { Db } from '../db/connect.js';
import type { PlayersTable, RoundsTable } from '../db/schema.js';
import { notFound } from '../errors.js';
import { LEADERBOARD_MIN_ANSWERS, LEADERBOARD_WINDOW, RECENT_ROUNDS } from './config.js';
import { accuracyOf, averagePointsOf, bestAndWorst, rankPlayers } from './ranking.js';

/**
 * The only place answer counts, accuracies and points totals are computed. Everything is
 * derived from `questions.correct` and `questions.points` (both computed once by the answer
 * route) and is never stored as a counter.
 */

export function toPlayer(row: Selectable<PlayersTable>): Player {
  return {
    id: row.id,
    displayName: row.display_name,
    color: row.color,
    createdAt: row.created_at.toISOString(),
  };
}

interface Counts {
  answered: number;
  correct: number;
  points: number;
}

const num = (v: string | number | null | undefined) => Number(v ?? 0);

/** Answered and correct counts per round, for the given rounds. */
async function roundCounts(db: Db, roundIds: readonly string[]): Promise<Map<string, Counts>> {
  const out = new Map<string, Counts>();
  if (roundIds.length === 0) return out;
  const rows = await db
    .selectFrom('questions')
    .select([
      'round_id',
      sql<string>`count(*)`.as('answered'),
      sql<string>`count(*) filter (where correct)`.as('correct'),
      sql<string>`coalesce(sum(points), 0)`.as('points'),
    ])
    .where('round_id', 'in', roundIds)
    .where('answered_at', 'is not', null)
    .groupBy('round_id')
    .execute();
  for (const r of rows)
    out.set(r.round_id, {
      answered: num(r.answered),
      correct: num(r.correct),
      points: num(r.points),
    });
  return out;
}

/** Answered and correct counts for one round: the one source for /next, /answer and Round. */
export async function roundProgress(db: Db, roundId: string): Promise<Counts> {
  return (await roundCounts(db, [roundId])).get(roundId) ?? { answered: 0, correct: 0, points: 0 };
}

/** The one completion rule: a round is done once `length` questions are answered. */
export function isRoundComplete(answered: number, length: number): boolean {
  return answered >= length;
}

/** Round rows to the API Round shape, with answered/correct counts from `questions`. */
export async function toRounds(db: Db, rows: readonly Selectable<RoundsTable>[]): Promise<Round[]> {
  const counts = await roundCounts(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((r) => ({
    id: r.id,
    playerId: r.player_id,
    length: r.length,
    startedAt: r.started_at.toISOString(),
    endedAt: r.ended_at ? r.ended_at.toISOString() : null,
    answered: counts.get(r.id)?.answered ?? 0,
    correct: counts.get(r.id)?.correct ?? 0,
    points: counts.get(r.id)?.points ?? 0,
  }));
}

export async function toRound(db: Db, row: Selectable<RoundsTable>): Promise<Round> {
  const [round] = await toRounds(db, [row]);
  if (!round) throw new Error('toRounds returned no round for one row');
  return round;
}

export async function loadRound(db: Db, roundId: string): Promise<Round> {
  const row = await db
    .selectFrom('rounds')
    .selectAll()
    .where('id', '=', roundId)
    .executeTakeFirst();
  if (!row) throw notFound('Round');
  return toRound(db, row);
}

interface EmotionRow {
  emotion: Emotion;
  answered: string;
  correct: string;
}

/** A per-emotion row that also carries the summed points. */
interface EmotionPointsRow extends EmotionRow {
  points: string;
}

/** One tally per emotion, in EMOTIONS order, including emotions with no answers. */
function emotionTallies(rows: readonly EmotionRow[]): EmotionTally[] {
  const byEmotion = new Map(rows.map((r) => [r.emotion, r]));
  return EMOTIONS.map((emotion) => {
    const answered = num(byEmotion.get(emotion)?.answered);
    const correct = num(byEmotion.get(emotion)?.correct);
    return { emotion, answered, correct, accuracy: accuracyOf(answered, correct) };
  });
}

/** Per-emotion tallies for one round. */
export async function roundEmotionTallies(db: Db, roundId: string): Promise<EmotionTally[]> {
  const rows = await db
    .selectFrom('questions as q')
    .innerJoin('images as i', 'i.id', 'q.image_id')
    .innerJoin('emotions as e', 'e.id', 'i.emotion_id')
    .select([
      'e.name as emotion',
      sql<string>`count(*)`.as('answered'),
      sql<string>`count(*) filter (where q.correct)`.as('correct'),
    ])
    .where('q.round_id', '=', roundId)
    .where('q.answered_at', 'is not', null)
    .groupBy('e.name')
    .execute();
  return emotionTallies(rows as EmotionRow[]);
}

export async function playerStats(db: Db, playerId: string): Promise<PlayerStats> {
  const playerRow = await db
    .selectFrom('players')
    .selectAll()
    .where('id', '=', playerId)
    .executeTakeFirst();
  if (!playerRow) throw notFound('Player');

  const answered = db
    .selectFrom('questions as q')
    .innerJoin('images as i', 'i.id', 'q.image_id')
    .innerJoin('emotions as e', 'e.id', 'i.emotion_id')
    .where('q.player_id', '=', playerId)
    .where('q.answered_at', 'is not', null);

  const [emotionRows, angleRows, confusionRows, roundRows] = await Promise.all([
    answered
      .select([
        'e.name as emotion',
        sql<string>`count(*)`.as('answered'),
        sql<string>`count(*) filter (where q.correct)`.as('correct'),
        sql<string>`coalesce(sum(q.points), 0)`.as('points'),
      ])
      .groupBy('e.name')
      .execute(),
    answered
      .select([
        'i.angle',
        sql<string>`count(*)`.as('answered'),
        sql<string>`count(*) filter (where q.correct)`.as('correct'),
      ])
      .groupBy('i.angle')
      .execute(),
    answered
      .innerJoin('emotions as c', 'c.id', 'q.chosen_emotion_id')
      .select(['e.name as actual', 'c.name as chosen', sql<string>`count(*)`.as('count')])
      .where('q.correct', '=', false)
      .groupBy(['e.name', 'c.name'])
      .execute(),
    db
      .selectFrom('rounds')
      .selectAll()
      .where('player_id', '=', playerId)
      .where('ended_at', 'is not', null)
      .orderBy('started_at', 'desc')
      .limit(RECENT_ROUNDS)
      .execute(),
  ]);

  const emotionPointRows = emotionRows as EmotionPointsRow[];
  const perEmotion = emotionTallies(emotionPointRows);
  const angleByName = new Map(angleRows.map((r) => [r.angle, r]));
  const perAngle: AngleTally[] = ANGLES.map((angle) => {
    const a = num(angleByName.get(angle)?.answered);
    const c = num(angleByName.get(angle)?.correct);
    return { angle, answered: a, correct: c, accuracy: accuracyOf(a, c) };
  });

  const confusionOrder = (e: Emotion) => EMOTIONS.indexOf(e);
  const confusion: ConfusionCell[] = confusionRows
    .map((r) => ({ actual: r.actual as Emotion, chosen: r.chosen as Emotion, count: num(r.count) }))
    .sort(
      (a, b) =>
        confusionOrder(a.actual) - confusionOrder(b.actual) ||
        confusionOrder(a.chosen) - confusionOrder(b.chosen),
    );

  const totalAnswered = perEmotion.reduce((n, t) => n + t.answered, 0);
  const totalPoints = emotionPointRows.reduce((n, r) => n + num(r.points), 0);
  return {
    player: toPlayer(playerRow),
    totalAnswered,
    totalCorrect: perEmotion.reduce((n, t) => n + t.correct, 0),
    totalPoints,
    averagePoints: averagePointsOf(totalAnswered, totalPoints),
    perEmotion,
    perAngle,
    confusion,
    recentRounds: await toRounds(db, roundRows),
  };
}

export async function leaderboard(db: Db): Promise<Leaderboard> {
  const players = await db.selectFrom('players').selectAll().execute();

  // Points and accuracy over each player's last LEADERBOARD_WINDOW answers. Reads the same
  // partial index (player_id, answered_at DESC) as before, plus the points column from the heap.
  const windowRows = await sql<{
    player_id: string;
    answered: string;
    correct: string;
    points: string;
  }>`
    SELECT p.id AS player_id, count(w.*) AS answered, count(w.*) FILTER (WHERE w.correct) AS correct,
      coalesce(sum(w.points), 0) AS points
    FROM players p
    LEFT JOIN LATERAL (
      SELECT q.correct, q.points FROM questions q
      WHERE q.player_id = p.id AND q.answered_at IS NOT NULL
      ORDER BY q.answered_at DESC, q.id
      LIMIT ${LEADERBOARD_WINDOW}
    ) w ON true
    GROUP BY p.id`.execute(db);

  // Per-emotion accuracy over all history, for best/worst emotion; also gives totals.
  // Deliberately all history (the spec), so it reads every answered row once: EXPLAIN ANALYZE
  // at 20 players x 2000 answers (40k rows) is a seq scan + hash aggregate in about 13 ms and
  // grows linearly. No index can avoid reading those rows, so there is no V003.
  const emotionRows = await db
    .selectFrom('questions as q')
    .innerJoin('images as i', 'i.id', 'q.image_id')
    .innerJoin('emotions as e', 'e.id', 'i.emotion_id')
    .select([
      'q.player_id',
      'e.name as emotion',
      sql<string>`count(*)`.as('answered'),
      sql<string>`count(*) filter (where q.correct)`.as('correct'),
    ])
    .where('q.answered_at', 'is not', null)
    .groupBy(['q.player_id', 'e.name'])
    .execute();

  const windows = new Map(windowRows.rows.map((r) => [r.player_id, r]));
  const perPlayer = new Map<string, { emotion: Emotion; answered: number; correct: number }[]>();
  for (const r of emotionRows) {
    const list = perPlayer.get(r.player_id) ?? [];
    list.push({
      emotion: r.emotion as Emotion,
      answered: num(r.answered),
      correct: num(r.correct),
    });
    perPlayer.set(r.player_id, list);
  }

  const inputs = players.map((row) => {
    const w = windows.get(row.id);
    const emotions = perPlayer.get(row.id) ?? [];
    return {
      player: toPlayer(row),
      createdAt: row.created_at.toISOString(),
      windowAnswered: num(w?.answered),
      windowCorrect: num(w?.correct),
      windowPoints: num(w?.points),
      totalAnswered: emotions.reduce((n, e) => n + e.answered, 0),
      emotions,
    };
  });

  const entries: LeaderboardEntry[] = rankPlayers(inputs).map(({ item, rank }) => {
    const { best, worst } = bestAndWorst(item.emotions);
    return {
      player: item.player,
      rank,
      windowAnswered: item.windowAnswered,
      windowCorrect: item.windowCorrect,
      accuracy: accuracyOf(item.windowAnswered, item.windowCorrect),
      avgPoints: averagePointsOf(item.windowAnswered, item.windowPoints),
      totalAnswered: item.totalAnswered,
      bestEmotion: best,
      worstEmotion: worst,
    };
  });

  return { windowSize: LEADERBOARD_WINDOW, minAnswers: LEADERBOARD_MIN_ANSWERS, entries };
}
