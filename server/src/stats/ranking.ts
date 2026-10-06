import { EMOTIONS, accuracyOf, type Emotion } from '@kdef/shared';
import { LEADERBOARD_EMOTION_MIN_ANSWERS } from './config.js';

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
