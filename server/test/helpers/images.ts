import { createHash } from 'node:crypto';
import { EMOTIONS, type Angle, type Emotion } from '@kdef/shared';
import type { Db } from '../../src/db/connect.js';

export interface ImageSpec {
  emotion: Emotion;
  subjectKey: number;
  angle?: Angle;
  content?: Buffer;
  contentType?: string;
}

/** Insert one fake image row (tests never read KDEF) and return its id. */
export async function insertImage(db: Db, spec: ImageSpec): Promise<string> {
  const angle = spec.angle ?? 'frontal';
  const content = spec.content ?? Buffer.from(`fake-${spec.emotion}-${spec.subjectKey}-${angle}`);
  const emotion = await db
    .selectFrom('emotions')
    .select('id')
    .where('name', '=', spec.emotion)
    .executeTakeFirstOrThrow();
  const row = await db
    .insertInto('images')
    .values({
      emotion_id: emotion.id,
      subject_key: spec.subjectKey,
      source_file: `${spec.emotion}/${spec.subjectKey}_${angle}_${createHash('md5').update(content).digest('hex')}.jpg`,
      angle,
      content,
      content_type: spec.contentType ?? 'image/jpeg',
      sha256: createHash('sha256').update(content).digest('hex'),
      width: 4,
      height: 4,
      created_at: new Date('2026-01-01T00:00:00Z'),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

export interface PoolImage {
  id: string;
  emotion: Emotion;
  subjectKey: number;
  angle: Angle;
}

/** Build a pool such as 5 subjects x 7 emotions x 3 angles. */
export async function insertPool(
  db: Db,
  opts: {
    subjects?: number;
    emotions?: readonly Emotion[];
    angles?: readonly Angle[];
  } = {},
): Promise<PoolImage[]> {
  const subjects = opts.subjects ?? 5;
  const emotions = opts.emotions ?? EMOTIONS;
  const angles = opts.angles ?? (['frontal', 'half_left', 'half_right'] as const);
  const out: PoolImage[] = [];
  for (const emotion of emotions)
    for (let subjectKey = 1; subjectKey <= subjects; subjectKey++)
      for (const angle of angles) {
        const id = await insertImage(db, { emotion, subjectKey, angle });
        out.push({ id, emotion, subjectKey, angle });
      }
  return out;
}
