import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EMOTIONS } from '@kdef/shared';
import { migrate, readMigrations, DEFAULT_MIGRATIONS_DIR } from '../src/db/migrate.js';
import { createTestDb, type TestDb } from './helpers/testDb.js';

describe('migrations', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => t.destroy());

  it('seeds exactly the shared EMOTIONS list', async () => {
    const rows = await t.db.selectFrom('emotions').select('name').orderBy('id').execute();
    expect(rows.map((r) => r.name)).toEqual([...EMOTIONS]);
  });

  it('is idempotent: a second run applies nothing', async () => {
    expect(await migrate(t.url)).toEqual({ applied: [] });
  });

  it('refuses to run when an applied migration file was edited', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'kdef-mig-'));
    const [first] = await readMigrations(DEFAULT_MIGRATIONS_DIR);
    await writeFile(
      path.join(dir, `V${first!.version}__${first!.name}.sql`),
      `${first!.sql}\n-- edited`,
    );
    await expect(migrate(t.url, dir)).rejects.toThrow(/checksum mismatch/);
  });

  it('rejects badly named migration files', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'kdef-mig-'));
    await writeFile(path.join(dir, 'init.sql'), 'SELECT 1');
    await expect(readMigrations(dir)).rejects.toThrow(/must match/);
  });

  it('enforces the answered/unanswered question invariant', async () => {
    const q = sql`INSERT INTO questions (round_id, player_id, position, image_id, asked_at, correct)
      VALUES (gen_random_uuid(), gen_random_uuid(), 1, gen_random_uuid(), now(), true)`;
    // CHECK constraints run before (deferred-trigger) FK checks, so this is the invariant firing.
    await expect(q.execute(t.db)).rejects.toThrow(/check constraint/);
  });
});
