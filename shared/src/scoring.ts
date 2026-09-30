/**
 * Speed scoring: the one place the constants and the formulas live. The server scores answers
 * with these, and the web mock (web/src/mocks/mockApi.ts) calls the same functions, so the two
 * cannot drift.
 */

/** Points for a correct answer given within GRACE_MS. */
export const MAX_POINTS = 100;

/** A correct answer this fast (in milliseconds) or faster earns the full MAX_POINTS. */
export const GRACE_MS = 1000;

/** After the grace period, the points for a correct answer halve every this many milliseconds. */
export const HALF_LIFE_MS = 4000;

/**
 * The client's own elapsed time (photo loaded to answer) can be shorter than the server's
 * (question issued to answer) by at most this many milliseconds, which covers the photo load.
 * The scored time is never below the server's time minus this, so a client cannot claim
 * near-zero time to score full points on every hit.
 */
export const LOAD_ALLOWANCE_MS = 2000;

/** A correct answer never earns less than this, however slow. A miss earns 0. */
export const MIN_POINTS = 1;

/**
 * The one points formula. A miss scores 0. A correct answer scores
 * `max(MIN_POINTS, round(MAX_POINTS * 2^(-max(0, t - GRACE_MS) / HALF_LIFE_MS)))`,
 * where `t` is the answer time in milliseconds. Computed once, in the answer route, and
 * stored in `questions.points`; the server's backfill calls this same function.
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
