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

## Fixture images

Tests never read KDEF. Use the small synthetic JPEGs under `server/test/fixtures/` (and `e2e/fixtures/`), laid out like the real dataset: `<emotion>/<subject>_<n>.jpg`.
