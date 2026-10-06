/**
 * Leaderboard ranking: the one place the accuracy and average formulas and the ranking rule
 * live. The server ranks with these, and the web mock (web/src/mocks/mockApi.ts) calls the same
 * functions, so the two cannot drift. The threshold is a parameter because the server
 * (LEADERBOARD_MIN_ANSWERS in server/src/stats/config.ts) and the mock use different values.
 */

/** Accuracy from counts, or null when nothing was answered. The one accuracy formula. */
export function accuracyOf(answered: number, correct: number): number | null {
  return answered === 0 ? null : correct / answered;
}

/** Average points per answer, or null when nothing was answered. The one average formula. */
export function averagePointsOf(answered: number, points: number): number | null {
  return answered === 0 ? null : points / answered;
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
 * Ranked players (windowAnswered >= minAnswers) come first, ordered by window accuracy
 * descending, then by more window answers. Points play no part in the order. Players equal on
 * both share a rank (competition ranking: 1, 2, 2, 4). Unranked players follow with rank null,
 * ordered by more window answers, then by creation time.
 */
export function rankPlayers<T extends RankInput>(
  players: readonly T[],
  minAnswers: number,
): { item: T; rank: number | null }[] {
  const ranked = players.filter((p) => p.windowAnswered >= minAnswers);
  const unranked = players.filter((p) => p.windowAnswered < minAnswers);
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
