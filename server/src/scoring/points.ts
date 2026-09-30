import { GRACE_MS, HALF_LIFE_MS, LOAD_ALLOWANCE_MS, MAX_POINTS, MIN_POINTS } from './config.js';

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
 * The one place the scored time is derived. With no client value it is the server's time
 * (`questions.response_ms`). Otherwise it is the client's time clamped to
 * [serverMs - LOAD_ALLOWANCE_MS, serverMs] (and never below 0): the client can shorten its time
 * by at most the photo-load allowance and can never lengthen it. Whole milliseconds.
 */
export function effectiveElapsedMs(serverMs: number, clientMs: number | undefined): number {
  if (clientMs === undefined) return serverMs;
  const floor = Math.max(0, serverMs - LOAD_ALLOWANCE_MS);
  return Math.min(serverMs, Math.max(floor, clientMs));
}
