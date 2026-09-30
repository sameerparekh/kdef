import { sql } from 'kysely';
import type { Db } from '../db/connect.js';
import { pointsFor } from './points.js';

/**
 * Fills `questions.points` for answered rows that predate the column (V003), from their
 * stored `response_ms`, using the same `pointsFor` as the answer route. SQL cannot call the
 * TypeScript formula, so this runs from TypeScript at boot, after migrations. It only touches
 * rows whose points are still null (V003 has a partial index on exactly those rows, so once
 * everything is filled each boot is an empty index probe), so it is idempotent. It relies on
 * running before the server accepts requests: an old instance still serving after a newer one
 * has backfilled would leave null points (counted as 0) until the next boot.
 * Returns the number of rows updated.
 */
export async function backfillPoints(db: Db): Promise<number> {
  return db.transaction().execute(async (trx) => {
    const misses = await sql`
      UPDATE questions SET points = 0
      WHERE answered_at IS NOT NULL AND points IS NULL AND NOT correct`.execute(trx);

    const distinct = await sql<{ ms: number }>`
      SELECT DISTINCT response_ms AS ms FROM questions
      WHERE answered_at IS NOT NULL AND points IS NULL AND correct`.execute(trx);
    const times = distinct.rows.map((r) => r.ms);
    let hits = 0n;
    if (times.length > 0) {
      const points = times.map((ms) => pointsFor(true, ms));
      const res = await sql`
        UPDATE questions q SET points = v.points
        FROM unnest(${times}::int[], ${points}::int[]) AS v(ms, points)
        WHERE q.answered_at IS NOT NULL AND q.points IS NULL AND q.correct
          AND q.response_ms = v.ms`.execute(trx);
      hits = res.numAffectedRows ?? 0n;
    }
    return Number((misses.numAffectedRows ?? 0n) + hits);
  });
}
