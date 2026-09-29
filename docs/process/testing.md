# Testing

## Server

- **Default to feature tests through the whole stack.** Use `createTestApp()` (`server/test/helpers/testApp.ts`) and `app.inject(...)`. That runs routes, services and Kysely against a real Postgres database created and migrated for that test file.
- **Never mock the database, the repo layer, the clock or the RNG.** Inject them instead: `TestClock` (`server/src/clock.ts`) and `seededRng(seed)` (`server/src/rng.ts`). Mocks are only for genuinely external I/O, and this app has none today.
- **Unit tests** are for pure logic with many edge cases: the adaptive picker, stats math, config parsing.
- **Statistical behaviour** (for example "missed emotions come up more often") is tested by simulation with a fixed seed and a tolerance, never by asserting a single random draw.
- **No `sleep` or wall-clock waits.** Advance `TestClock` instead.
- **Parse responses with the shared schemas** (`Health.parse(res.json())`, …), so tests also pin the contract.
- **Postgres:** `npm run db:up` starts it on `localhost:55432`. `TEST_DATABASE_URL` points at an admin DB where the tests may create and drop databases. CI uses a service container.

## Web

- Vitest + Testing Library + jsdom. Intercept HTTP at the network boundary with the shared MSW handlers (`web/src/mocks/`), the same ones behind `VITE_MOCK_API=true`; don't mock the query hooks or `fetch` call sites.
- Every data view has tests for the loading, error and loaded states (see `loading-states.md`).

## End-to-end

- One Playwright smoke test (`e2e/smoke.spec.ts`, chromium only) runs against the real Docker image, not a dev server: create a player without a colour, play a 20-question round by keyboard, check the feedback and contrast image, the summary, the stats confusion grid and the leaderboard, reload mid-round, check that no image alt text names an emotion, and check that restarting the app container logs `seed: skipped`.
- `npm run e2e` (`e2e/run.sh`) starts the stack as compose project `kdef-e2e` (`e2e/docker-compose.e2e.yml`, app on port 18080, no db port), runs Playwright, and always tears the stack down with `-v`. It can run beside a dev stack.
- It is the only test that exercises the live RNG and the production wiring; keep it small. Behaviour with many cases belongs in the server feature tests.

## Fixture images

Tests never read KDEF. Use the small synthetic JPEGs under `server/test/fixtures/` (and `e2e/fixtures/`, 3 subjects x 7 emotions x 3 photos with a matching `angles.csv`), laid out like the real dataset: `<emotion>/<subject>_<n>.jpg`.
