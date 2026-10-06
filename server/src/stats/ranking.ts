import { EMOTIONS, type Emotion } from '@kdef/shared';
import { LEADERBOARD_EMOTION_MIN_ANSWERS, LEADERBOARD_MIN_ANSWERS } from './config.js';

/** Accuracy from counts, or null when nothing was answered. The one accuracy formula. */
export function accuracyOf(answered: number, correct: number): number | null {
  return answered === 0 ? null : correct / answered;
}

/** Average points per answer, or null when nothing was answered. The one average formula. */
export function averagePointsOf(answered: number, points: number): number | null {
  return answered === 0 ? null : points / answered;
}

export interface EmotionCounts {
  emotion: Emotion;
  answered: number;
  correct: number;
}

/**
 * Best and worst emotion by accuracy, among emotions with at least
 * LEADERBOARD_EMOTION_MIN_ANSWERS answers. Ties go to the emotion earlier in EMOTIONS.
 * Both null when no emotion qualifies.
 */
export function bestAndWorst(counts: readonly EmotionCounts[]): {
  best: Emotion | null;
  worst: Emotion | null;
} {
  const qualified = counts
    .filter((c) => c.answered >= LEADERBOARD_EMOTION_MIN_ANSWERS)
    .map((c) => ({ emotion: c.emotion, accuracy: accuracyOf(c.answered, c.correct) ?? 0 }))
    .sort((a, b) => EMOTIONS.indexOf(a.emotion) - EMOTIONS.indexOf(b.emotion));
  const [first] = qualified;
  if (!first) return { best: null, worst: null };
  let best = first;
  let worst = first;
  for (const q of qualified) {
    if (q.accuracy > best.accuracy) best = q;
    if (q.accuracy < worst.accuracy) worst = q;
  }
  return { best: best.emotion, worst: worst.emotion };
}

export interface RankInput {
  windowAnswered: number;
  windowCorrect: number;
  /** Tie-breaker of last resort (earlier first); ISO timestamp of player creation. */
  createdAt: string;
}

/**
 * Order players for the leaderboard and assign ranks.
 *
 * Ranked players (windowAnswered >= LEADERBOARD_MIN_ANSWERS) come first, ordered by window
 * accuracy descending, then by more window answers. Points play no part in the order.
 * Players equal on both share a rank (competition ranking: 1, 2, 2, 4). Unranked players
 * follow with rank null, ordered by more window answers, then by creation time.
 */
export function rankPlayers<T extends RankInput>(
  players: readonly T[],
): { item: T; rank: number | null }[] {
  const ranked = players.filter((p) => p.windowAnswered >= LEADERBOARD_MIN_ANSWERS);
  const unranked = players.filter((p) => p.windowAnswered < LEADERBOARD_MIN_ANSWERS);
  const acc = (p: RankInput) => accuracyOf(p.windowAnswered, p.windowCorrect) ?? 0;
  const byCreated = (a: RankInput, b: RankInput) => a.createdAt.localeCompare(b.createdAt);

  ranked.sort((a, b) => acc(b) - acc(a) || b.windowAnswered - a.windowAnswered || byCreated(a, b));
  unranked.sort((a, b) => b.windowAnswered - a.windowAnswered || byCreated(a, b));

  const out: { item: T; rank: number | null }[] = [];
  let rank = 0;
  ranked.forEach((item, i) => {
    const prev = ranked[i - 1];
    const tied = prev && acc(prev) === acc(item) && prev.windowAnswered === item.windowAnswered;
    if (!tied) rank = i + 1;
    out.push({ item, rank });
  });
  for (const item of unranked) out.push({ item, rank: null });
  return out;
}
