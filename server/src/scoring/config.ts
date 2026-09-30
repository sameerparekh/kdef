/**
 * Speed-scoring constants: the one place they live. The formula that uses them is
 * `pointsFor` in ./points.ts.
 */

/** Points for a correct answer given within GRACE_MS. */
export const MAX_POINTS = 100;

/** A correct answer this fast (in milliseconds) or faster earns the full MAX_POINTS. */
export const GRACE_MS = 1000;

/** After the grace period, the points for a correct answer halve every this many milliseconds. */
export const HALF_LIFE_MS = 4000;

/** A correct answer never earns less than this, however slow. A miss earns 0. */
export const MIN_POINTS = 1;
