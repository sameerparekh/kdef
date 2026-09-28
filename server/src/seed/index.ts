import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Insertable } from 'kysely';
import { ANGLES, EMOTIONS, type Angle, type Emotion } from '@kdef/shared';
import type { Clock } from '../clock.js';
import type { Db } from '../db/connect.js';
import type { ImagesTable } from '../db/schema.js';
import { jpegSize } from './jpeg.js';
import { manifestKey, readAngleManifest, type AngleManifest } from './manifest.js';

export { DEFAULT_MANIFEST_PATH } from './manifest.js';

/** Rows per INSERT; bounds memory (files are read per batch) and stays far below pg's 65535-parameter cap. */
const BATCH_SIZE = 100;
const FILE_PATTERN = /^(\d+)_(\d+)\.jpg$/;

export interface SeedDeps {
  db: Db;
  clock: Clock;
  /** KDEF_DIR. Required only when there is something to load. */
  kdefDir: string | undefined;
  manifestPath: string;
  log: (line: string) => void;
}

export interface SeedSummary {
  status: 'seeded';
  inserted: number;
  byEmotion: Record<Emotion, number>;
  byAngle: Record<Angle, number>;
  elapsedMs: number;
}

export type SeedResult = SeedSummary | { status: 'skipped'; existing: number };

interface DatasetFile {
  emotion: Emotion;
  filename: string;
  subjectKey: number;
  fullPath: string;
}

/**
 * Boot-time seeding: a no-op when `images` already has rows; otherwise loads the dataset
 * (which requires KDEF_DIR, docs/process/no-dark-by-default.md). This is the only place that
 * decides "KDEF_DIR is needed because the table is empty".
 */
export async function ensureImagesSeeded(deps: SeedDeps): Promise<SeedResult> {
  const existing = await countImages(deps.db);
  if (existing > 0) {
    deps.log(`seed: skipped, ${existing} images present`);
    return { status: 'skipped', existing };
  }
  if (!deps.kdefDir) {
    throw new Error(
      'The images table is empty and KDEF_DIR is not set. Set KDEF_DIR to the directory with the ' +
        'KDEF emotion folders so the server can load the images on first startup.',
    );
  }
  return loadImages(deps, deps.kdefDir, { upsert: false });
}

/**
 * `npm run reseed`: re-reads KDEF_DIR and upserts by (emotion_id, source_file). Existing ids are
 * kept, because questions reference images; nothing is ever deleted.
 */
export async function reseedImages(deps: SeedDeps): Promise<SeedSummary> {
  if (!deps.kdefDir) throw new Error('KDEF_DIR must be set to reseed images.');
  return loadImages(deps, deps.kdefDir, { upsert: true });
}

async function countImages(db: Db): Promise<number> {
  const row = await db
    .selectFrom('images')
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .executeTakeFirstOrThrow();
  return Number(row.n);
}

/** The one code path for both the first seed and reseed. */
async function loadImages(
  deps: SeedDeps,
  kdefDir: string,
  opts: { upsert: boolean },
): Promise<SeedSummary> {
  const { db, clock, log } = deps;
  const startedAt = clock.now();
  const manifest = await readAngleManifest(deps.manifestPath);
  const files = await scanDataset(kdefDir);
  const emotionIds = await loadEmotionIds(db);
  const createdAt = clock.now();

  const byEmotion = Object.fromEntries(EMOTIONS.map((e) => [e, 0])) as Record<Emotion, number>;
  const byAngle = Object.fromEntries(ANGLES.map((a) => [a, 0])) as Record<Angle, number>;
  log(`seed: loading ${files.length} images from ${kdefDir}${opts.upsert ? ' (upsert)' : ''}`);

  await db.transaction().execute(async (trx) => {
    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const rows = await Promise.all(
        files.slice(i, i + BATCH_SIZE).map((f) => buildRow(f, emotionIds, manifest, createdAt)),
      );
      const insert = trx.insertInto('images').values(rows);
      await (
        opts.upsert
          ? insert.onConflict((oc) =>
              oc.columns(['emotion_id', 'source_file']).doUpdateSet((eb) => ({
                subject_key: eb.ref('excluded.subject_key'),
                angle: eb.ref('excluded.angle'),
                content: eb.ref('excluded.content'),
                content_type: eb.ref('excluded.content_type'),
                sha256: eb.ref('excluded.sha256'),
                width: eb.ref('excluded.width'),
                height: eb.ref('excluded.height'),
              })),
            )
          : insert
      ).execute();
    }
  });

  for (const f of files) {
    byEmotion[f.emotion]++;
    byAngle[manifest.get(manifestKey(f.emotion, f.filename)) ?? 'unknown']++;
  }
  const elapsedMs = clock.now().getTime() - startedAt.getTime();
  const fmt = (o: Record<string, number>) =>
    Object.entries(o)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');
  log(`seed: ${opts.upsert ? 'upserted' : 'inserted'} ${files.length} images in ${elapsedMs} ms`);
  log(`seed: per emotion: ${fmt(byEmotion)}`);
  log(`seed: per angle: ${fmt(byAngle)}`);
  log(`seed: ${byAngle.unknown} unknown angle (not in ${deps.manifestPath})`);
  return { status: 'seeded', inserted: files.length, byEmotion, byAngle, elapsedMs };
}

/** Lists <kdefDir>/<emotion>/<subject>_<n>.jpg; anything unexpected fails loud. Dotfiles are ignored. */
async function scanDataset(kdefDir: string): Promise<DatasetFile[]> {
  const isDir = await stat(kdefDir)
    .then((s) => s.isDirectory())
    .catch(() => false);
  if (!isDir) throw new Error(`KDEF_DIR (${kdefDir}) is not a readable directory.`);

  const files: DatasetFile[] = [];
  for (const emotion of EMOTIONS) {
    const folder = path.join(kdefDir, emotion);
    let entries;
    try {
      entries = await readdir(folder, { withFileTypes: true });
    } catch {
      throw new Error(`KDEF_DIR is missing the emotion folder "${emotion}" (${folder}).`);
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.')) continue;
      const m = FILE_PATTERN.exec(entry.name);
      if (!entry.isFile() || !m) {
        throw new Error(
          `Unexpected entry ${emotion}/${entry.name}: expected files named <subject>_<n>.jpg.`,
        );
      }
      files.push({
        emotion,
        filename: entry.name,
        subjectKey: Number(m[1]),
        fullPath: path.join(folder, entry.name),
      });
    }
  }
  return files;
}

async function loadEmotionIds(db: Db): Promise<Map<Emotion, number>> {
  const rows = await db.selectFrom('emotions').select(['id', 'name']).execute();
  const ids = new Map(rows.map((r) => [r.name, r.id]));
  return new Map(
    EMOTIONS.map((e) => {
      const id = ids.get(e);
      if (id === undefined) throw new Error(`emotions table has no row for "${e}"`);
      return [e, id];
    }),
  );
}

async function buildRow(
  f: DatasetFile,
  emotionIds: Map<Emotion, number>,
  manifest: AngleManifest,
  createdAt: Date,
): Promise<Insertable<ImagesTable>> {
  const content = await readFile(f.fullPath);
  let size;
  try {
    size = jpegSize(content);
  } catch (err) {
    throw new Error(`${f.emotion}/${f.filename}: ${(err as Error).message}`);
  }
  return {
    emotion_id: emotionIds.get(f.emotion)!,
    subject_key: f.subjectKey,
    source_file: f.filename,
    angle: manifest.get(manifestKey(f.emotion, f.filename)) ?? 'unknown',
    content,
    content_type: 'image/jpeg',
    sha256: createHash('sha256').update(content).digest('hex'),
    width: size.width,
    height: size.height,
    created_at: createdAt,
  };
}
