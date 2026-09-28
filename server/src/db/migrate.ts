import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

/**
 * Applies db/migrations/V<n>__<name>.sql in version order, each in its own transaction,
 * recording version + checksum in schema_migrations. An applied migration whose file
 * changed is a hard error: migrations are immutable (docs/process/migrations.md).
 */

// server/src/db and server/dist/db are both three levels below the repo root.
export const DEFAULT_MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../db/migrations',
);

const FILE_PATTERN = /^V(\d+)__([a-z0-9_]+)\.sql$/;
/** Arbitrary constant key so concurrent boots serialize on the same advisory lock. */
const MIGRATION_LOCK_KEY = 4_815_162_342;

export interface MigrationFile {
  version: number;
  name: string;
  sql: string;
  checksum: string;
}

export async function readMigrations(dir: string): Promise<MigrationFile[]> {
  const entries = (await readdir(dir)).filter((f) => f.endsWith('.sql'));
  const files: MigrationFile[] = [];
  for (const file of entries) {
    const m = FILE_PATTERN.exec(file);
    if (!m) throw new Error(`Migration file name must match V<n>__<snake_name>.sql: ${file}`);
    const sql = await readFile(path.join(dir, file), 'utf8');
    files.push({
      version: Number(m[1]),
      name: m[2]!,
      sql,
      checksum: createHash('sha256').update(sql).digest('hex'),
    });
  }
  files.sort((a, b) => a.version - b.version);
  for (let i = 1; i < files.length; i++) {
    if (files[i]!.version === files[i - 1]!.version) {
      throw new Error(`Duplicate migration version V${files[i]!.version}`);
    }
  }
  return files;
}

export async function migrate(
  databaseUrl: string,
  dir: string = DEFAULT_MIGRATIONS_DIR,
): Promise<{ applied: number[] }> {
  const files = await readMigrations(dir);
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version    integer PRIMARY KEY,
      name       text NOT NULL,
      checksum   text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const { rows } = await client.query<{ version: number; checksum: string }>(
      'SELECT version, checksum FROM schema_migrations',
    );
    const appliedChecksums = new Map(rows.map((r) => [r.version, r.checksum]));

    const applied: number[] = [];
    for (const f of files) {
      const existing = appliedChecksums.get(f.version);
      if (existing !== undefined) {
        if (existing !== f.checksum) {
          throw new Error(
            `Migration V${f.version}__${f.name} was edited after it was applied (checksum mismatch). ` +
              'Migrations are immutable; add a new migration instead.',
          );
        }
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(f.sql);
        await client.query(
          'INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
          [f.version, f.name, f.checksum],
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration V${f.version}__${f.name} failed: ${(err as Error).message}`);
      }
      applied.push(f.version);
    }
    return { applied };
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => {});
    await client.end();
  }
}
