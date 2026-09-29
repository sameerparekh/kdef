import type { Angle, Emotion } from '@kdef/shared';

export function emotionLabel(emotion: Emotion): string {
  return emotion[0]!.toUpperCase() + emotion.slice(1);
}

const ANGLE_LABELS: Record<Angle, string> = {
  frontal: 'Frontal',
  half_left: 'Turned left',
  half_right: 'Turned right',
  unknown: 'Unknown',
};

export function angleLabel(angle: Angle): string {
  return ANGLE_LABELS[angle];
}

/** "75%" for a ratio in [0, 1]; null (no answers to compute it from) is "not asked", never 0%. */
export function formatAccuracy(accuracy: number | null): string {
  return accuracy === null ? 'not asked' : `${Math.round(accuracy * 100)}%`;
}
