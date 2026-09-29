import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Angle, Emotion } from '@kdef/shared';

/**
 * seed/angles.csv (`emotion,filename,angle`), produced by scripts/classify-angles.py.
 * server/src/seed and server/dist/seed are both three levels below the repo root, the same
 * trick as DEFAULT_MIGRATIONS_DIR in ../db/migrate.ts.
 */
export const DEFAULT_MANIFEST_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../seed/angles.csv',
);

const HEADER = 'emotion,filename,angle';

/** Map keyed by `<emotion>/<filename>`. */
export type AngleManifest = ReadonlyMap<string, Angle>;

export function manifestKey(emotion: string, filename: string): string {
  return `${emotion}/${filename}`;
}

export async function readAngleManifest(manifestPath: string): Promise<AngleManifest> {
  let text: string;
  try {
    text = await readFile(manifestPath, 'utf8');
  } catch (err) {
    throw new Error(`Cannot read the angle manifest at ${manifestPath}: ${(err as Error).message}`);
  }
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  if (lines[0]?.trim() !== HEADER) {
    throw new Error(`Angle manifest ${manifestPath} must start with the header "${HEADER}"`);
  }
  const manifest = new Map<string, Angle>();
  lines.slice(1).forEach((line, idx) => {
    const where = `${manifestPath} line ${idx + 2}`;
    const cols = line.trim().split(',');
    if (cols.length !== 3) throw new Error(`Angle manifest ${where}: expected 3 columns`);
    const [emotion, filename, angle] = cols as [string, string, string];
    const e = Emotion.safeParse(emotion);
    if (!e.success) throw new Error(`Angle manifest ${where}: unknown emotion "${emotion}"`);
    const a = Angle.safeParse(angle);
    if (!a.success) throw new Error(`Angle manifest ${where}: unknown angle "${angle}"`);
    const key = manifestKey(e.data, filename);
    if (manifest.has(key)) throw new Error(`Angle manifest ${where}: duplicate entry ${key}`);
    manifest.set(key, a.data);
  });
  return manifest;
}
