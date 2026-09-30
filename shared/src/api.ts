import { z } from 'zod';
import { Angle, Emotion } from './emotions.js';

/**
 * The HTTP contract between server/ and web/. Every request and response body is defined
 * here exactly once; the server validates with these schemas and the SPA parses with them.
 */

const Uuid = z.string().uuid();
const IsoDateTime = z.string().datetime({ offset: true });
/** Accuracy in [0, 1], or null when there are no answers to compute it from. */
const Accuracy = z.number().min(0).max(1).nullable();

export const ApiError = z.object({ error: z.string(), message: z.string() });
export type ApiError = z.infer<typeof ApiError>;

export const Health = z.object({ status: z.literal('ok'), images: z.number().int().nonnegative() });
export type Health = z.infer<typeof Health>;

// ---- players ----

export const PlayerColor = z.string().regex(/^#[0-9a-f]{6}$/i);

export const Player = z.object({
  id: Uuid,
  displayName: z.string(),
  color: PlayerColor,
  createdAt: IsoDateTime,
});
export type Player = z.infer<typeof Player>;

/** `DELETE /api/players/:id` answers 204 with no body; the client reads that as `null`. */
export const NoContent = z.null();
export type NoContent = z.infer<typeof NoContent>;

export const PlayerList = z.object({ players: z.array(Player) });
export type PlayerList = z.infer<typeof PlayerList>;

export const CreatePlayerRequest = z.object({
  displayName: z.string().trim().min(1).max(30),
  color: PlayerColor.optional(),
});
export type CreatePlayerRequest = z.infer<typeof CreatePlayerRequest>;

// ---- rounds & questions ----

export const Round = z.object({
  id: Uuid,
  playerId: Uuid,
  length: z.number().int().positive(),
  startedAt: IsoDateTime,
  endedAt: IsoDateTime.nullable(),
  answered: z.number().int().nonnegative(),
  correct: z.number().int().nonnegative(),
});
export type Round = z.infer<typeof Round>;

export const Question = z.object({
  questionId: Uuid,
  /** Opaque URL; never encodes the emotion. */
  imageUrl: z.string(),
  /** 1-based position within the round. */
  position: z.number().int().positive(),
  total: z.number().int().positive(),
});
export type Question = z.infer<typeof Question>;

/**
 * POST /api/rounds/:id/next. Returns the current unanswered question if there is one
 * (so a page reload resumes), a new question otherwise, or `complete` when the round is done.
 */
export const NextResponse = z.discriminatedUnion('status', [
  z.object({ status: z.literal('question'), question: Question }),
  z.object({ status: z.literal('complete') }),
]);
export type NextResponse = z.infer<typeof NextResponse>;

export const AnswerRequest = z.object({ emotion: Emotion });
export type AnswerRequest = z.infer<typeof AnswerRequest>;

export const AnswerResponse = z.object({
  correct: z.boolean(),
  correctEmotion: Emotion,
  chosenEmotion: Emotion,
  /** On a miss: the same person showing the emotion that was guessed. Null when correct. */
  contrastImageUrl: z.string().nullable(),
  roundComplete: z.boolean(),
});
export type AnswerResponse = z.infer<typeof AnswerResponse>;

export const EmotionTally = z.object({
  emotion: Emotion,
  answered: z.number().int().nonnegative(),
  correct: z.number().int().nonnegative(),
  accuracy: Accuracy,
});
export type EmotionTally = z.infer<typeof EmotionTally>;

export const RoundSummary = z.object({ round: Round, perEmotion: z.array(EmotionTally) });
export type RoundSummary = z.infer<typeof RoundSummary>;

// ---- stats & leaderboard ----

export const AngleTally = z.object({
  angle: Angle,
  answered: z.number().int().nonnegative(),
  correct: z.number().int().nonnegative(),
  accuracy: Accuracy,
});
export type AngleTally = z.infer<typeof AngleTally>;

export const ConfusionCell = z.object({
  actual: Emotion,
  chosen: Emotion,
  count: z.number().int().positive(),
});
export type ConfusionCell = z.infer<typeof ConfusionCell>;

export const PlayerStats = z.object({
  player: Player,
  totalAnswered: z.number().int().nonnegative(),
  totalCorrect: z.number().int().nonnegative(),
  perEmotion: z.array(EmotionTally),
  perAngle: z.array(AngleTally),
  /** Sparse: only cells with count > 0. */
  confusion: z.array(ConfusionCell),
  /** Most recent completed rounds, newest first. */
  recentRounds: z.array(Round),
});
export type PlayerStats = z.infer<typeof PlayerStats>;

export const LeaderboardEntry = z.object({
  player: Player,
  /** Null when the player has fewer than `minAnswers` answers and is unranked. */
  rank: z.number().int().positive().nullable(),
  windowAnswered: z.number().int().nonnegative(),
  windowCorrect: z.number().int().nonnegative(),
  accuracy: Accuracy,
  totalAnswered: z.number().int().nonnegative(),
  bestEmotion: Emotion.nullable(),
  worstEmotion: Emotion.nullable(),
});
export type LeaderboardEntry = z.infer<typeof LeaderboardEntry>;

export const Leaderboard = z.object({
  /** Accuracy is computed over each player's last `windowSize` answers. */
  windowSize: z.number().int().positive(),
  /** Minimum answers before a player is ranked. */
  minAnswers: z.number().int().positive(),
  entries: z.array(LeaderboardEntry),
});
export type Leaderboard = z.infer<typeof Leaderboard>;
