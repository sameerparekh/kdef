import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EMOTIONS, Health } from '@kdef/shared';
import { TestClock } from '../src/clock.js';
import { DEFAULT_MANIFEST_PATH, ensureImagesSeeded, reseedImages } from '../src/seed/index.js';
import { readAngleManifest } from '../src/seed/manifest.js';
import { createTestApp, type TestContext } from './helpers/testApp.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_KDEF = path.join(here, 'fixtures/kdef');
const FIXTURE_MANIFEST = path.join(here, 'fixtures/angles.csv');
/** 7 emotions x 2 subjects x 3 photos. */
const FIXTURE_COUNT = 42;

describe('image seeding', () => {
  let ctx: TestContext;
  let logs: string[];
  const clock = new TestClock('2026-03-04T05:06:07.000Z');
  const log = (line: string) => logs.push(line);
  const deps = (over: Partial<Parameters<typeof ensureImagesSeeded>[0]> = {}) => ({
    db: ctx.testDb.db,
    clock,
    kdefDir: FIXTURE_KDEF,
    manifestPath: FIXTURE_MANIFEST,
    log,
    ...over,
  });

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => ctx.close());
  beforeEach(async () => {
    logs = [];
    await ctx.testDb.reset();
  });

  it('seeds every fixture image with its metadata and manifest angle', async () => {
    const result = await ensureImagesSeeded(deps());
    expect(result).toMatchObject({ status: 'seeded', inserted: FIXTURE_COUNT });

    const rows = await ctx.testDb.db
      .selectFrom('images')
      .innerJoin('emotions', 'emotions.id', 'images.emotion_id')
      .select([
        'emotions.name as emotion',
        'images.source_file',
        'images.subject_key',
        'images.angle',
        'images.content',
        'images.content_type',
        'images.sha256',
        'images.width',
        'images.height',
        'images.created_at',
      ])
      .execute();
    expect(rows).toHaveLength(FIXTURE_COUNT);

    const byKey = new Map(rows.map((r) => [`${r.emotion}/${r.source_file}`, r]));
    const row = byKey.get('happy/1_7.jpg')!;
    const bytes = await readFile(path.join(FIXTURE_KDEF, 'happy/1_7.jpg'));
    expect(row.content.equals(bytes)).toBe(true);
    expect(row.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(row).toMatchObject({
      content_type: 'image/jpeg',
      subject_key: 1,
      width: 8,
      height: 10,
      angle: 'half_right',
    });
    expect(row.created_at).toEqual(new Date('2026-03-04T05:06:07.000Z'));
    expect(byKey.get('angry/0_3.jpg')!.angle).toBe('half_left');
    expect(byKey.get('angry/0_7.jpg')!.angle).toBe('frontal');
    expect(new Set(rows.map((r) => r.emotion))).toEqual(new Set(EMOTIONS));
  });

  it('uses unknown for photos missing from the manifest and logs how many', async () => {
    await ensureImagesSeeded(deps());
    const row = await ctx.testDb.db
      .selectFrom('images')
      .innerJoin('emotions', 'emotions.id', 'images.emotion_id')
      .select('images.angle')
      .where('emotions.name', '=', 'sad')
      .where('images.source_file', '=', '1_11.jpg') // deliberately absent from the fixture manifest
      .executeTakeFirstOrThrow();
    expect(row.angle).toBe('unknown');
    expect(logs.join('\n')).toMatch(/1 missing from the manifest/);
    expect(logs.join('\n')).toMatch(/angry: 6/);
    expect(logs.join('\n')).toMatch(/frontal: 14/);
  });

  it('fails loud and inserts nothing when manifest entries match no file (incomplete listing)', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'kdef-manifest-test-'));
    try {
      const manifest = path.join(dir, 'angles.csv');
      const base = await readFile(FIXTURE_MANIFEST, 'utf8');
      await writeFile(manifest, `${base}angry,99_99.jpg,frontal\n`);
      await expect(ensureImagesSeeded(deps({ manifestPath: manifest }))).rejects.toThrow(
        /1 manifest entries have no file.*angry\/99_99\.jpg/s,
      );
      const n = await ctx.testDb.db
        .selectFrom('images')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .executeTakeFirstOrThrow();
      expect(Number(n.n)).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('does not count manifest entries labelled unknown as missing from the manifest', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'kdef-manifest-test-'));
    try {
      const manifest = path.join(dir, 'angles.csv');
      const base = await readFile(FIXTURE_MANIFEST, 'utf8');
      const kept = base.split('\n').filter((l) => l !== 'angry,0_3.jpg,half_left');
      await writeFile(manifest, `${kept.join('\n')}angry,0_3.jpg,unknown\n`);
      await ensureImagesSeeded(deps({ manifestPath: manifest }));
      expect(logs.join('\n')).toMatch(/1 missing from the manifest/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('skips when images are already present, without touching the KDEF directory', async () => {
    await ensureImagesSeeded(deps());
    logs = [];
    const second = await ensureImagesSeeded(deps({ kdefDir: undefined }));
    expect(second).toEqual({ status: 'skipped', existing: FIXTURE_COUNT });
    expect(logs).toEqual([`seed: skipped, ${FIXTURE_COUNT} images present`]);
  });

  it('crashes with a clear message when the table is empty and KDEF_DIR is unset', async () => {
    await expect(ensureImagesSeeded(deps({ kdefDir: undefined }))).rejects.toThrow(
      /images table is empty.*KDEF_DIR/s,
    );
  });

  it('crashes when the table is empty and KDEF_DIR is not readable', async () => {
    await expect(
      ensureImagesSeeded(deps({ kdefDir: path.join(tmpdir(), 'kdef-does-not-exist') })),
    ).rejects.toThrow(/KDEF_DIR.*not a readable directory/s);
  });

  describe('with a broken dataset directory', () => {
    let dir: string;
    beforeEach(async () => {
      dir = await mkdtemp(path.join(tmpdir(), 'kdef-seed-test-'));
      await cp(FIXTURE_KDEF, dir, { recursive: true });
    });
    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it('fails loud on a missing emotion folder and inserts nothing', async () => {
      await rm(path.join(dir, 'fear'), { recursive: true });
      await expect(ensureImagesSeeded(deps({ kdefDir: dir }))).rejects.toThrow(/fear/);
      const n = await ctx.testDb.db.selectFrom('images').select('id').execute();
      expect(n).toHaveLength(0);
    });

    it('fails loud on a file name that does not match <subject>_<n>.jpg', async () => {
      await writeFile(path.join(dir, 'happy', 'portrait.jpg'), 'x');
      await expect(ensureImagesSeeded(deps({ kdefDir: dir }))).rejects.toThrow(/portrait\.jpg/);
    });

    it('ignores dotfiles such as .DS_Store', async () => {
      await writeFile(path.join(dir, 'happy', '.DS_Store'), 'x');
      const result = await ensureImagesSeeded(deps({ kdefDir: dir }));
      expect(result).toMatchObject({ status: 'seeded', inserted: FIXTURE_COUNT });
    });

    it('rolls the whole transaction back if a later file is not a JPEG', async () => {
      await writeFile(path.join(dir, 'surprise', '1_11.jpg'), 'not a jpeg');
      await expect(ensureImagesSeeded(deps({ kdefDir: dir }))).rejects.toThrow(/1_11\.jpg/);
      const n = await ctx.testDb.db.selectFrom('images').select('id').execute();
      expect(n).toHaveLength(0);
    });
  });

  it('fails loud when the manifest is missing or malformed', async () => {
    await expect(
      ensureImagesSeeded(deps({ manifestPath: path.join(tmpdir(), 'no-such-angles.csv') })),
    ).rejects.toThrow(/manifest/i);

    const dir = await mkdtemp(path.join(tmpdir(), 'kdef-manifest-test-'));
    try {
      const bad = path.join(dir, 'angles.csv');
      await writeFile(bad, 'emotion,filename,angle\nangry,0_3.jpg,sideways\n');
      await expect(ensureImagesSeeded(deps({ manifestPath: bad }))).rejects.toThrow(/sideways/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  describe('reseed', () => {
    it('upserts in place: ids stay, changed columns update, nothing is deleted', async () => {
      await ensureImagesSeeded(deps());
      const before = await ctx.testDb.db
        .selectFrom('images')
        .select(['id', 'emotion_id', 'source_file'])
        .execute();

      // Simulate a stale row plus an extra row that is not in the dataset.
      await ctx.testDb.db
        .updateTable('images')
        .set({ angle: 'unknown', sha256: 'stale', width: 1, height: 1 })
        .where('source_file', '=', '0_7.jpg')
        .execute();
      await ctx.testDb.db
        .insertInto('images')
        .values({
          emotion_id: 1,
          subject_key: 999,
          source_file: '999_1.jpg',
          angle: 'unknown',
          content: Buffer.from('x'),
          content_type: 'image/jpeg',
          sha256: 'x',
          width: 1,
          height: 1,
          created_at: clock.now(),
        })
        .execute();

      const result = await reseedImages(deps());
      expect(result).toMatchObject({ status: 'seeded', inserted: FIXTURE_COUNT });

      const after = await ctx.testDb.db
        .selectFrom('images')
        .select(['id', 'emotion_id', 'source_file', 'angle', 'sha256', 'width', 'height'])
        .execute();
      expect(after).toHaveLength(FIXTURE_COUNT + 1);
      const idOf = (rows: { id: string; emotion_id: number; source_file: string }[]) =>
        new Map(rows.map((r) => [`${r.emotion_id}/${r.source_file}`, r.id]));
      const beforeIds = idOf(before);
      const afterIds = idOf(after);
      for (const [key, id] of beforeIds) expect(afterIds.get(key)).toBe(id);

      const fixed = after.find((r) => r.emotion_id === 1 && r.source_file === '0_7.jpg')!;
      expect(fixed).toMatchObject({ angle: 'frontal', width: 8, height: 10 });
      expect(fixed.sha256).not.toBe('stale');
    });

    it('requires KDEF_DIR', async () => {
      await expect(reseedImages(deps({ kdefDir: undefined }))).rejects.toThrow(/KDEF_DIR/);
    });

    it('reseeding an empty table behaves like a first seed', async () => {
      const result = await reseedImages(deps());
      expect(result).toMatchObject({ status: 'seeded', inserted: FIXTURE_COUNT });
    });
  });

  it('makes /api/health report the seeded count', async () => {
    await ensureImagesSeeded(deps());
    const res = await ctx.app.inject({ method: 'GET', url: '/api/health' });
    expect(Health.parse(res.json())).toEqual({ status: 'ok', images: FIXTURE_COUNT });
  });
});

describe('committed manifest', () => {
  it('has the header and one valid row per line', async () => {
    const text = await readFile(DEFAULT_MANIFEST_PATH, 'utf8');
    const lines = text.trimEnd().split('\n');
    expect(lines[0]).toBe('emotion,filename,angle');
    expect(lines.length).toBeGreaterThan(1);
    const sorted = [...lines.slice(1)].sort();
    expect(lines.slice(1)).toEqual(sorted);
  });

  it('parses with the seeder reader and has at most one of each angle per group', async () => {
    const manifest = await readAngleManifest(DEFAULT_MANIFEST_PATH);
    const seen = new Set<string>();
    for (const [key, angle] of manifest) {
      if (angle === 'unknown') continue;
      const [emotion, filename] = key.split('/') as [string, string];
      const group = `${emotion}/${filename.split('_')[0]}/${angle}`;
      expect(seen.has(group), `duplicate ${angle} in ${emotion} subject ${filename}`).toBe(false);
      seen.add(group);
    }
  });
});
