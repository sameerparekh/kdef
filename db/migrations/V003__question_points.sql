-- Speed scoring (#23): points earned by an answer, computed once by the answer route from
-- correctness and response time and stored here. NULL until answered; rows answered before this
-- migration are filled at boot by server/src/scoring/backfill.ts, which uses the same TypeScript
-- formula as the answer route (SQL cannot call it, and a second copy of the formula in SQL
-- would have to be kept in step).
--
-- Adding a nullable column with no default is a catalog-only change in Postgres, so it does
-- not rewrite `questions`.
ALTER TABLE questions ADD COLUMN points integer CHECK (points >= 0);
