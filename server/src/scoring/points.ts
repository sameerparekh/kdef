import { GRACE_MS, HALF_LIFE_MS, MAX_POINTS, MIN_POINTS } from './config.js';

/**
 * The one points formula. A miss scores 0. A correct answer scores
 * `max(MIN_POINTS, round(MAX_POINTS * 2^(-max(0, t - GRACE_MS) / HALF_LIFE_MS)))`,
 * where `t` is the answer time in milliseconds. Computed once, in the answer route, and
 * stored in `questions.points`; the backfill (./backfill.ts) calls this same function.
 */
export function pointsFor(correct: boolean, elapsedMs: number): number {
  if (!correct) return 0;
  const decayed = MAX_POINTS * 2 ** (-Math.max(0, elapsedMs - GRACE_MS) / HALF_LIFE_MS);
  return Math.max(MIN_POINTS, Math.round(decayed));
}

/**
 * The time a question is scored on: the smaller of what the server measured and what the
 * client reported (the client clock starts when the photo finished loading, the server's when
 * the question was issued), so the client can shorten its time but never lengthen it. A
 * missing or negative client value is ignored. Whole milliseconds.
 */
export function effectiveElapsedMs(serverMs: number, clientMs: number | undefined): number {
  const usable = clientMs !== undefined && clientMs >= 0;
  return Math.round(usable ? Math.min(serverMs, clientMs) : serverMs);
}
