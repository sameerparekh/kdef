-- Speed scoring (#23): points earned by an answer, computed once by the answer route from
-- correctness and the effective answer time, and stored here. NULL until answered; rows answered
-- before this migration are filled at boot by server/src/scoring/backfill.ts, which uses the same
-- TypeScript formula as the answer route (SQL cannot call it, and a second copy of the formula in
-- SQL would have to be kept in step).
--
-- response_ms stays the raw server measurement. client_elapsed_ms keeps the client's reported
-- time exactly as sent (NULL when not sent), so the effective time can be re-derived later.
--
-- Adding nullable columns with no default is a catalog-only change in Postgres, so it does
-- not rewrite `questions`.
ALTER TABLE questions ADD COLUMN points integer CHECK (points >= 0);
ALTER TABLE questions ADD COLUMN client_elapsed_ms integer CHECK (client_elapsed_ms >= 0);

-- The backfill's work list: answered rows still without points. Empty once the backfill has
-- run (new answers get their points in the same UPDATE), so each later boot is an index probe.
CREATE INDEX questions_unscored_idx ON questions (id)
  WHERE answered_at IS NOT NULL AND points IS NULL;
