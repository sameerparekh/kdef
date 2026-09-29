import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Insertable } from 'kysely';
import { ANGLES, EMOTIONS, type Angle, type Emotion } from '@kdef/shared';
import type { Clock } from '../clock.js';
import type { Db } from '../db/connect.js';
import type { ImagesTable } from '../db/schema.js';
import { jpegSize } from './jpeg.js';
import { manifestKey, readAngleManifest } from './manifest.js';

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
    await assertManifestSeeded(deps);
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

/**
 * An already-seeded table must still hold every manifest image. A short table (e.g. from an
 * incomplete listing before this check existed) fails boot instead of quizzing on a subset.
 */
async function assertManifestSeeded(deps: SeedDeps): Promise<void> {
  const manifest = await readAngleManifest(deps.manifestPath);
  const rows = await deps.db
    .selectFrom('images')
    .innerJoin('emotions', 'emotions.id', 'images.emotion_id')
    .select(['emotions.name as emotion', 'images.source_file'])
    .execute();
  const present = new Set(rows.map((r) => manifestKey(r.emotion, r.source_file)));
  const missing = [...manifest.keys()].filter((k) => !present.has(k));
  if (missing.length > 0) {
    throw new Error(
      `seed: ${missing.length} manifest images are missing from the images table ` +
        `(first: ${missing.slice(0, 5).join(', ')}). Run a reseed with KDEF_DIR set to add them ` +
        '(`npm run reseed -w server`, or `docker compose exec app node server/dist/reseedCli.js`); ' +
        'it upserts and keeps existing ids.',
    );
  }
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

  // The one place a file's angle is decided; the inserted rows and the logged tallies both read it.
  const plan = files.map((file) => {
    const fromManifest = manifest.get(manifestKey(file.emotion, file.filename));
    return {
      file,
      angle: fromManifest ?? ('unknown' as const),
      inManifest: fromManifest !== undefined,
    };
  });
  const byEmotion = Object.fromEntries(EMOTIONS.map((e) => [e, 0])) as Record<Emotion, number>;
  const byAngle = Object.fromEntries(ANGLES.map((a) => [a, 0])) as Record<Angle, number>;
  for (const p of plan) {
    byEmotion[p.file.emotion]++;
    byAngle[p.angle]++;
  }
  const missingFromManifest = plan.filter((p) => !p.inManifest).length;
  const found = new Set(files.map((f) => manifestKey(f.emotion, f.filename)));
  const noFile = [...manifest.keys()].filter((k) => !found.has(k));
  if (noFile.length > 0) {
    // The manifest is the expected inventory. Entries with no file mean the dataset is
    // incomplete, or the directory listing was (e.g. a network share seen through Docker).
    // Refuse rather than seed a partial set; nothing has been inserted yet, so a restart retries.
    throw new Error(
      `seed: ${noFile.length} manifest entries have no file in ${kdefDir} ` +
        `(first: ${noFile.slice(0, 5).join(', ')}). The dataset or its directory listing is ` +
        `incomplete; refusing to seed a partial set (manifest: ${deps.manifestPath}). ` +
        `Found ${files.length} files. If the folder is on a network share, retry (a restart does); ` +
        'if a subset is intended, point SEED_MANIFEST at a manifest for it.',
    );
  }
  log(`seed: loading ${files.length} images from ${kdefDir}${opts.upsert ? ' (upsert)' : ''}`);

  await db.transaction().execute(async (trx) => {
    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const rows = await Promise.all(
        plan.slice(i, i + BATCH_SIZE).map((p) => buildRow(p.file, p.angle, emotionIds, createdAt)),
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

  const elapsedMs = clock.now().getTime() - startedAt.getTime();
  const fmt = (o: Record<string, number>) =>
    Object.entries(o)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');
  log(`seed: ${opts.upsert ? 'upserted' : 'inserted'} ${files.length} images in ${elapsedMs} ms`);
  log(`seed: per emotion: ${fmt(byEmotion)}`);
  log(`seed: per angle: ${fmt(byAngle)}`);
  log(
    `seed: ${missingFromManifest} missing from the manifest (stored as unknown) (${deps.manifestPath})`,
  );
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
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? 'unknown error';
      throw new Error(
        `KDEF_DIR: cannot read the emotion folder "${emotion}" (${folder}): ${code}. It must exist and be readable.`,
      );
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
  angle: Angle,
  emotionIds: Map<Emotion, number>,
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
    angle,
    content,
    content_type: 'image/jpeg',
    sha256: createHash('sha256').update(content).digest('hex'),
    width: size.width,
    height: size.height,
    created_at: createdAt,
  };
}
