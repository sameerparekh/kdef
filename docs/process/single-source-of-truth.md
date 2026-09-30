# Single source of truth

The same logical quantity or decision is computed in exactly **one** place; every other consumer calls it.

**The named sources in this repo:**

| fact | source |
|---|---|
| API request and response shapes | `shared/src/api.ts` |
| Emotion names and order, angle values | `shared/src/emotions.ts` (mirrored by the V001 seed rows; a test pins the match) |
| Whether an answer was correct | computed once in the answer route, stored in `questions.correct` |
| Per-emotion, per-angle and confusion stats, leaderboard numbers | the one server stats module; never stored as counters |
| Speed-scoring constants, `pointsFor` and the client-time clamp `effectiveElapsedMs` | `shared/src/scoring.ts`; the server and the web mock both import it |
| Adaptive tuning constants | the one adaptive config module, one commented constant each |
| Leaderboard window and min-answers | server config, returned in the `Leaderboard` response, so the SPA never hardcodes them |

**When two places seem to need the same logic:**

1. **COLLAPSE** it into one function that both places call.
2. If you can't, **TYPE-ENFORCE** it, so the compiler rejects drift. For example, `z.enum(EMOTIONS)` everywhere instead of string literals.
3. Otherwise **ACCEPT + TEST-PIN**: a test that fails if the copies diverge. The V001 emotion rows against `EMOTIONS` is an example.

A comment such as "keep in sync with X" is a smell. Reviewers flag it (checklist §1).
