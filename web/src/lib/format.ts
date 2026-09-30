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

/** "2.3 s": elapsed milliseconds as seconds with one decimal. */
export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

/** "87 points", or "1 point": the one place the singular is decided. */
export function formatPoints(points: number): string {
  return `${points} ${points === 1 ? 'point' : 'points'}`;
}

/** "+87 points" for an answer's award ("+1 point", "+0 points"). */
export function formatPointsEarned(points: number): string {
  return `+${formatPoints(points)}`;
}

/** "37.5" for average points per answer; null (nothing to average) is a dash, never 0. */
export function formatAvgPoints(avg: number | null): string {
  return avg === null ? '—' : avg.toFixed(1);
}

/** "75%" for a ratio in [0, 1]; null (no answers to compute it from) is "not asked", never 0%. */
export function formatAccuracy(accuracy: number | null): string {
  return accuracy === null ? 'not asked' : `${Math.round(accuracy * 100)}%`;
}
