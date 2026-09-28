import { z } from 'zod';

/**
 * The seven KDEF emotion categories. Names match the dataset's folder names and the
 * `emotions` rows seeded by db/migrations/V001__init.sql; the wire uses names, not ids.
 */
export const EMOTIONS = [
  'angry',
  'disgust',
  'fear',
  'happy',
  'neutral',
  'sad',
  'surprise',
] as const;
export const Emotion = z.enum(EMOTIONS);
export type Emotion = z.infer<typeof Emotion>;

/** Camera angle of a photo; matches the `image_angle` enum in V001__init.sql. */
export const ANGLES = ['frontal', 'half_left', 'half_right', 'unknown'] as const;
export const Angle = z.enum(ANGLES);
export type Angle = z.infer<typeof Angle>;
