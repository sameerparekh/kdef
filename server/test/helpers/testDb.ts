import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { connect, type Db } from '../../src/db/connect.js';
import { migrate } from '../../src/db/migrate.js';

/**
 * A real, freshly-migrated Postgres database per test file. Never mock the DB
 * (docs/process/testing.md). TEST_DATABASE_URL points at an admin database on a server
 * we may CREATE/DROP databases on; `npm run db:up` starts one on localhost:55432.
 */
const ADMIN_URL = process.env.TEST_DATABASE_URL ?? 'postgres://kdef:kdef@localhost:55432/postgres';

export interface TestDb {
  db: Db;
  url: string;
  /** Delete all rows from player/round/question/image tables (emotions are fixed). */
  reset(): Promise<void>;
  destroy(): Promise<void>;
}

export async function createTestDb(): Promise<TestDb> {
  const name = `kdef_test_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();

  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  await migrate(url.toString());
  const db = connect(url.toString());

  return {
    db,
    url: url.toString(),
    async reset() {
      await db.deleteFrom('questions').execute();
      await db.deleteFrom('rounds').execute();
      await db.deleteFrom('players').execute();
      await db.deleteFrom('images').execute();
    },
    async destroy() {
      await db.destroy();
      const a = new pg.Client({ connectionString: ADMIN_URL });
      await a.connect();
      await a.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await a.end();
    },
  };
}
