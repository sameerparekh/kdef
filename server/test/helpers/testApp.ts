import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { TestClock } from '../../src/clock.js';
import { seededRng, type Rng } from '../../src/rng.js';
import { createTestDb, type TestDb } from './testDb.js';

export interface TestContext {
  app: FastifyInstance;
  testDb: TestDb;
  clock: TestClock;
  rng: Rng;
  close(): Promise<void>;
}

/** Full-stack harness: real Fastify app (use app.inject) over a real test database. */
export async function createTestApp(seed = 42): Promise<TestContext> {
  const testDb = await createTestDb();
  const clock = new TestClock();
  const rng = seededRng(seed);
  const app = await buildApp({ db: testDb.db, clock, rng }, { logLevel: 'silent' });
  return {
    app,
    testDb,
    clock,
    rng,
    async close() {
      await app.close();
      await testDb.destroy();
    },
  };
}
