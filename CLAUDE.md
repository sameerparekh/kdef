# CLAUDE.md — KDEF emotion quiz

Context for AI coding agents (and humans) working in this repo. `AGENTS.md` is a symlink to this file.

## What this is

An adaptive quiz: a player sees a face from the KDEF dataset and picks one of 7 emotions (angry, disgust, fear, happy, neutral, sad, surprise). Several players can play, each with a profile picked from a "Who's playing?" screen; there are no passwords. The quiz adapts per player: **emotions** a player misses come up more often, and angled (half-profile) photos ramp in as the player masters the frontal ones. It trains the emotion, not individual photos, so photos a player missed get no priority. There is also a leaderboard.

- Runs locally with `docker compose up --build` → http://localhost:8080.
- Everything lives in Postgres, including the images. On first startup (empty `images` table) the server loads them from `KDEF_DIR`.
- **KDEF images are licensed for non-commercial research. Never commit them** (`.gitignore` blocks `*.jpg` outside test fixtures). `seed/angles.csv` is metadata only.
- A Render deploy may come later. Keep config env-driven and do not depend on a filesystem once the images are seeded.

## Layout

| path | what |
|---|---|
| `shared/` | zod schemas for every API request/response: **the** contract. The server validates with them; the SPA parses with them. |
| `server/` | Node 22, Fastify 5, Kysely + `pg`. `src/app.ts` builds the app from injected deps (`db`, `clock`, `rng`). |
| `web/` | React 18, Vite, TypeScript, Tailwind 3, @tanstack/react-query 5, react-router 7. |
| `db/migrations/` | `V<n>__<name>.sql`, applied at boot by `server/src/db/migrate.ts`. |
| `seed/` | `angles.csv`, a camera-angle manifest produced by `scripts/classify-angles.py`. |
| `docker/`, `docker-compose.yml` | Image and local stack (Postgres on host port 55432). |

## Running

```
npm install && npm run hooks:install
npm run db:up                      # postgres on localhost:55432
cp .env.example .env
npm run dev -w server              # API on :8080
npm run dev -w web                 # SPA on :5173, proxies /api
VITE_MOCK_API=true npm run dev -w web  # SPA on :5173 against in-memory MSW mocks, no server needed
npm test                           # server feature tests (real Postgres) + web tests
npm run lint && npm run typecheck && npm run format:check
```

Mock mode (`VITE_MOCK_API=true`) is an explicit opt-in: it is never enabled automatically, and the nav shows a "Mock API" badge while it is on. The handlers in `web/src/mocks/mockApi.ts` are also what the web tests run against (MSW in Vitest).

Check that Docker responds before running docker commands in an agent session. `docker info` should answer within about 2s; if Docker Desktop is wedged, docker commands hang instead of failing.

## Rules

Each rule has a short detail file under `docs/process/`.

- **TDD.** Write the failing test first. Autonomous or spawned sessions commit the failing test as its own commit, so red→green shows in history. → [`tdd.md`](docs/process/tdd.md)
- **Testing.** Feature tests go through the real stack: `app.inject` → routes → Kysely → a real, freshly-migrated Postgres (`server/test/helpers/testApp.ts`). Never mock the DB, clock or RNG; inject `TestClock` and `seededRng`. No `sleep`-waits. Unit tests are for pure logic (the adaptive picker, stats math). → [`testing.md`](docs/process/testing.md)
- **Injected time and randomness.** Server code never calls `Date.now()`, `new Date()` or `Math.random()`; ESLint enforces this. Use `Clock` (`server/src/clock.ts`) and `Rng` (`server/src/rng.ts`).
- **No dark-by-default.** Missing or invalid required config crashes boot and lists every problem at once (`server/src/config.ts`). A missing value is never a silent disable switch; optional behaviour gets an explicit, logged flag (e.g. `SERVE_SPA`). An empty image table with no readable `KDEF_DIR` is a boot failure, not an empty quiz. → [`no-dark-by-default.md`](docs/process/no-dark-by-default.md)
- **Single source of truth.** Each quantity or decision is computed in exactly one place, and everything else calls it:
  - API shapes are defined once in `shared/`.
  - Emotion names come from `EMOTIONS`.
  - Accuracy, confusion and leaderboard numbers come from one stats module, derived from `questions` and never kept as counters.
  - Adaptive tuning constants live in one config module, with a comment each.

  → [`single-source-of-truth.md`](docs/process/single-source-of-truth.md)
- **Migrations are immutable.** Never edit, rename or delete a merged migration; add `V<n+1>__…`. The runner refuses to start on a checksum mismatch, and CI checks this against the merge base. → [`migrations.md`](docs/process/migrations.md)
- **Loading states.** A pending query shows a spinner or skeleton, never a real-looking value (`0`, "0%", an empty chart). Every data view distinguishes loading, error and loaded. → [`loading-states.md`](docs/process/loading-states.md)
- **Never leak the answer.** Image URLs are opaque UUIDs. The emotion is revealed only by the answer response, and the adaptive pick happens server-side.
- **Verify and cite.** When stating a constant, a behaviour or a schema fact, cite the file that defines it; don't cite a comment or rely on memory. If you can't verify it, say so. → [`verify-and-cite.md`](docs/process/verify-and-cite.md)
- **TODOs link issues.** Use `TODO(#123): …` only; `.github/scripts/check-todos.sh` rejects bare markers.
- **Branch diffs use the merge base.** Write `origin/main...HEAD` (three dots), never two. → [`branch-diff-checks.md`](docs/process/branch-diff-checks.md)
- **Worktrees for spawned work.** Agents that edit files work in `.claude/worktrees/<slug>` on a branch cut from `origin/main`, and never touch the top-level checkout. → [`worktree-isolation.md`](docs/process/worktree-isolation.md)
- **Independent PR review.** Every PR gets a review pass by a separate agent using [`docs/pr-review-checklist.md`](docs/pr-review-checklist.md). It is posted as a marked PR comment and re-run on each push. Merge once CI is green and the latest review has no open BLOCKER. Merges are squash merges.
- **Declarative config.** Branch protection lives in `scripts/branch-protection.sh`, and CI in `.github/workflows/`. Change the script and re-run it; don't click in the settings UI.

## CI

`.github/workflows/ci.yml` runs lint/format/TODO checks, server typecheck + tests (with a Postgres service), web tests + build, the migration immutability check and the Docker build. An aggregator job named **`CI`** is the single required check.
