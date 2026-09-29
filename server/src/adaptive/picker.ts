import { EMOTIONS, type Angle, type Emotion } from '@kdef/shared';
import type { Rng } from '../rng.js';
import {
  ALPHA,
  ANGLED_MASTERY_OFFSET,
  ANGLED_MAX,
  ANGLED_MIN,
  ANGLED_WEAKNESS_MARGIN,
  ANGLED_WEAKNESS_MIN_ANSWERS,
  BETA,
  EMOTION_HISTORY_WINDOW,
  EMOTION_WEIGHT_FLOOR,
} from './config.js';

/**
 * The adaptive picker: pure functions of (history, candidates, rng), no DB access.
 * The caller fetches the player's history, calls pickEmotionAndTier, fetches candidate
 * images for that emotion, then calls pickImage.
 */

export type Tier = 'angled' | 'plain';

/** One answered question, described by the photo that was shown. */
export interface AnswerRecord {
  emotion: Emotion;
  angle: Angle;
  correct: boolean;
}

/** Angled = half-profile photos. Everything else (frontal, unknown) is the plain tier. */
export function isAngled(angle: Angle): boolean {
  return angle === 'half_left' || angle === 'half_right';
}

/** The most recent answers for one emotion. `history` is newest first. */
function windowFor(history: readonly AnswerRecord[], emotion: Emotion): AnswerRecord[] {
  const out: AnswerRecord[] = [];
  for (const r of history) {
    if (r.emotion !== emotion) continue;
    out.push(r);
    if (out.length === EMOTION_HISTORY_WINDOW) break;
  }
  return out;
}

const smoothedErrorRate = (misses: number, n: number) => (misses + ALPHA) / (n + ALPHA + BETA);
const smoothedAccuracy = (hits: number, n: number) => (hits + BETA) / (n + ALPHA + BETA);
const countCorrect = (records: readonly AnswerRecord[]) => records.filter((r) => r.correct).length;

/** Sampling weight per emotion: floor + smoothed error rate over its recent answers. */
export function emotionWeights(
  history: readonly AnswerRecord[],
  available: readonly Emotion[] = EMOTIONS,
): Record<Emotion, number> {
  const weights = {} as Record<Emotion, number>;
  for (const emotion of available) {
    const w = windowFor(history, emotion);
    weights[emotion] =
      EMOTION_WEIGHT_FLOOR + smoothedErrorRate(w.length - countCorrect(w), w.length);
  }
  return weights;
}

/** P(the next photo of `emotion` is angled), from the player's recent answers. */
export function angledProbability(history: readonly AnswerRecord[], emotion: Emotion): number {
  const w = windowFor(history, emotion);
  const plain = w.filter((r) => !isAngled(r.angle));
  const angled = w.filter((r) => isAngled(r.angle));
  const plainAcc = smoothedAccuracy(countCorrect(plain), plain.length);
  const angledAcc = smoothedAccuracy(countCorrect(angled), angled.length);
  if (
    angled.length >= ANGLED_WEAKNESS_MIN_ANSWERS &&
    angledAcc < plainAcc - ANGLED_WEAKNESS_MARGIN
  ) {
    return ANGLED_MIN;
  }
  return Math.min(ANGLED_MAX, Math.max(ANGLED_MIN, plainAcc - ANGLED_MASTERY_OFFSET));
}

/**
 * Step 1: choose the emotion (weighted by recent misses) and the angle tier. `available`
 * restricts the draw to emotions that have at least one image.
 */
export function pickEmotionAndTier(
  history: readonly AnswerRecord[],
  rng: Rng,
  available: readonly Emotion[] = EMOTIONS,
): { emotion: Emotion; tier: Tier } {
  if (available.length === 0) throw new Error('pickEmotionAndTier: no emotions available');
  const weights = emotionWeights(history, available);
  const total = available.reduce((sum, e) => sum + weights[e], 0);
  let x = rng.next() * total;
  let emotion: Emotion = available[available.length - 1] ?? EMOTIONS[0];
  for (const e of available) {
    x -= weights[e];
    if (x < 0) {
      emotion = e;
      break;
    }
  }
  const tier: Tier = rng.next() < angledProbability(history, emotion) ? 'angled' : 'plain';
  return { emotion, tier };
}

/** A uniformly random item (undefined only for an empty list). */
export function pickUniform<T>(items: readonly T[], rng: Rng): T | undefined {
  return items[Math.min(items.length - 1, Math.floor(rng.next() * items.length))];
}

/** Metadata about one candidate image for the chosen emotion. */
export interface Candidate {
  id: string;
  angle: Angle;
  subjectKey: number;
  /** How many times this player has been shown this image (asked, answered or not). */
  timesSeen: number;
}

export interface PickImageInput<C extends Candidate = Candidate> {
  candidates: readonly C[];
  tier: Tier;
  /** Ids of the player's most recently shown images (the caller applies RECENT_IMAGE_EXCLUSION). */
  recentImageIds: readonly string[];
  /** Subject keys of the player's last few questions (the caller applies RECENT_SUBJECT_AVOIDANCE). */
  recentSubjectKeys: readonly number[];
  rng: Rng;
}

const inTier = (c: Candidate, tier: Tier) => isAngled(c.angle) === (tier === 'angled');

/**
 * Step 2: choose an image. Chosen tier first, then the other tier if empty; recently shown
 * images are excluded unless that would leave nothing. Then least-seen, then a subject not
 * shown recently, then uniform. Misses never raise a photo's priority: only `timesSeen`
 * (which counts showings, not misses) is consulted. Returns null only with no candidates.
 */
export function pickImage<C extends Candidate>(input: PickImageInput<C>): C | null {
  const { candidates, tier, recentImageIds, recentSubjectKeys, rng } = input;
  if (candidates.length === 0) return null;
  const recent = new Set(recentImageIds);
  const other: Tier = tier === 'angled' ? 'plain' : 'angled';

  const fresh = candidates.filter((c) => !recent.has(c.id));
  let pool = fresh.filter((c) => inTier(c, tier));
  if (pool.length === 0) pool = fresh.filter((c) => inTier(c, other));
  if (pool.length === 0) pool = candidates.filter((c) => inTier(c, tier));
  if (pool.length === 0) pool = [...candidates];

  const minSeen = Math.min(...pool.map((c) => c.timesSeen));
  pool = pool.filter((c) => c.timesSeen === minSeen);

  const recentSubjects = new Set(recentSubjectKeys);
  const otherSubjects = pool.filter((c) => !recentSubjects.has(c.subjectKey));
  if (otherSubjects.length > 0) pool = otherSubjects;

  return pickUniform(pool, rng) ?? null;
}
