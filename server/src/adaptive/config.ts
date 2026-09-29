/** The one place for adaptive-quiz tuning constants (docs/process/single-source-of-truth.md). */

/**
 * How many of a player's most recent answers for an emotion feed that emotion's error rate.
 * A window (not all history) lets the mix follow the player as they improve.
 */
export const EMOTION_HISTORY_WINDOW = 30;

/**
 * Added to every emotion's weight, so an emotion the player has mastered still comes up
 * occasionally and can be noticed if they start slipping.
 */
export const EMOTION_WEIGHT_FLOOR = 0.05;

/**
 * Beta prior pseudo-counts for smoothing rates: ALPHA is a prior count of misses and BETA of
 * hits. Error rate = (misses + ALPHA) / (n + ALPHA + BETA); accuracy = (hits + BETA) / (n + ALPHA + BETA).
 * With Beta(1, 1) an emotion or tier with no data has a rate of 0.5 rather than a noisy 0 or 1.
 */
export const ALPHA = 1;
export const BETA = 1;

/**
 * P(angled photo) = clamp(smoothed frontal accuracy - ANGLED_MASTERY_OFFSET, ANGLED_MIN, ANGLED_MAX).
 * The offset means angled photos only start to ramp in once frontal accuracy is above 40%.
 * "Frontal" here means every non-angled photo: `unknown`-angle photos count as frontal.
 */
export const ANGLED_MASTERY_OFFSET = 0.4;

/** Lowest P(angled): even a beginner sees the occasional half-profile. */
export const ANGLED_MIN = 0.1;

/**
 * Highest P(angled): even an expert keeps seeing mostly frontal photos. Note it is not
 * actually reachable: with a 30-answer window and a Beta(1, 1) prior, perfect frontal accuracy
 * smooths to 31/32, so P(angled) tops out near 0.57. Kept as the specified ceiling.
 */
export const ANGLED_MAX = 0.7;

/**
 * "Well below": if the player's smoothed angled accuracy for an emotion is more than this far
 * under their smoothed frontal accuracy, angled photos stay in the mix but only at the floor
 * (P(angled) = ANGLED_MIN) instead of ramping up with frontal mastery. This is part of the
 * approved plan (the issue text omits it): a player who is fluent on frontal photos but still
 * fails half-profiles of the emotion should not be pushed towards more of them.
 */
export const ANGLED_WEAKNESS_MARGIN = 0.25;

/**
 * Minimum angled answers (in the window) for an emotion before the weakness check applies;
 * with less data the smoothed angled accuracy is mostly the prior and would wrongly hold a
 * player at the floor before they have tried any angled photos.
 */
export const ANGLED_WEAKNESS_MIN_ANSWERS = 3;

/** The last this-many shown images (asked, answered or not) are not shown again. */
export const RECENT_IMAGE_EXCLUSION = 50;

/**
 * Among equally-unseen images, prefer a subject (person) not among the last this-many
 * questions, so consecutive questions rarely show the same face.
 */
export const RECENT_SUBJECT_AVOIDANCE = 5;
