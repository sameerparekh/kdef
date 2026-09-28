# PR review checklist (independent, read-only, adversarial)

Every PR gets this review from a **separate agent**, not the author, before merge. The author runs it on their own work before opening the PR. The independent pass is the gate.

## How to run it

1. Read the PR body and the diff: `gh pr diff <n>`, or locally `git diff origin/main...HEAD` (three dots; see `docs/process/branch-diff-checks.md`).
2. Review **only** the changed lines, and cite `file:line` for every finding. **Do not modify files.**
3. Classify every finding:
   - **BLOCKER:** must be fixed before merge.
   - **SHOULD-FIX:** fix now unless there is a stated reason not to.
   - **NIT:** minor, non-blocking.
4. End with `VERDICT: APPROVE` or `VERDICT: REQUEST-CHANGES`. Never approve with an open BLOCKER.

## Posting and re-review

- **Post** the review as a PR comment (`gh pr comment <n> --body-file <file>`), not as a `gh pr review`. The first line must be the marker:

  ```
  <!-- kdef-pr-review reviewed-sha=<40-char head sha> -->
  ```

- **On every later push, re-run it:**
  1. Find the latest marked comment.
  2. Mark each prior finding **ADDRESSED**, **NOT-ADDRESSED** or **PARTIAL**.
  3. Review only `git diff <reviewed-sha>...HEAD` for new issues.
  4. Post a new marked comment with the new head sha.
- **Merge** once `CI` is green and the latest review has no open BLOCKER: `gh pr merge <n> --squash --delete-branch`.

## 1. Single source of truth (highest priority)

- **Re-derivation is a BLOCKER.** Does new code recompute something that already has a home? Examples: correctness of an answer, per-emotion accuracy, the emotion list, API shapes, adaptive constants. It must call the existing source; see `docs/process/single-source-of-truth.md`.
- **Keep-in-sync comments are a smell.** `// keep in sync`, a hand-copied list, or string literals where `Emotion` / `EMOTIONS` should be used all need fixing. Recommend COLLAPSE or TYPE-ENFORCE.
- **Mismatched sources.** Flag it when the UI reads a different source than the server logic for the same fact, e.g. a hardcoded leaderboard threshold in the SPA.
- **Duplicated shapes.** A request or response shape defined outside `shared/` is a BLOCKER.

## 2. Test integrity

- **Behaviour needs a test that fails without it.** New behaviour, or a bug fix, with no such test is a BLOCKER. For spawned work, check the red commit comes before the green one.
- **Weakened tests are a BLOCKER.** Look for assertions removed or loosened, tests deleted or skipped (`.skip`, `.only`), or tolerances widened to make CI pass.
- **Mocked internals.** Mocking the DB, repos, the clock or the RNG where the real thing or `TestClock` / `seededRng` would do is a SHOULD-FIX.
- **Flaky randomness.** A test that depends on an unseeded random draw, or on wall-clock timing, is a BLOCKER.
- **Missing view states.** UI data views need tests for loading, error and loaded.

## 3. Correctness and the quiz invariants

- **The answer never leaks before submission.** Check image URLs, response bodies, HTML, and the order images are fetched in. A leak is a BLOCKER.
- **Adaptive selection stays server-side and deterministic** given `(history, pool, rng)`.
- **Photos a player missed get no priority.** The quiz trains the emotion, not a memorised photo.
- **Config failures.** Missing or invalid config must fail loudly (`docs/process/no-dark-by-default.md`). A silent fallback that disables a feature is a BLOCKER.
- **Loading states** follow `docs/process/loading-states.md`.

## 4. Migrations

- **Merged migrations never change.** Editing, renaming or deleting one is a BLOCKER. New ones are `V<n+1>__…`.
- **Kysely types match.** `server/src/db/schema.ts` must be updated to match the new SQL.
- **New queries have indexes** that fit how they're accessed. The `questions` table grows without bound.

## 5. Scope and hygiene

- **Unrelated changes** are a SHOULD-FIX: split them out.
- **TODOs link issues** (`TODO(#n)`).
- **Dead code**, commented-out code and debug logging are a NIT, or a SHOULD-FIX if there's a lot.
- **Committed images.** No KDEF images in the diff; the licence forbids it. Committing one is a BLOCKER.

## 6. Security

- **Parameterised SQL only.** No string-built SQL containing user input.
- **Validate input.** All request bodies and params are validated with the `shared/` schemas.
- **No secrets** or `.env` files committed.

## 7. Unsourced facts and magic constants

- **Cite claims.** Claims in the PR body or comments about constants or behaviour must cite their source (`docs/process/verify-and-cite.md`).
- **Name magic numbers.** An unnamed number in logic (a threshold, window or weight) belongs in the relevant config module with a comment.
