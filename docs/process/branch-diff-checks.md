# Branch diffs use the merge base

When comparing a branch with `main` (in CI, hooks, reviews or scripts), use the three-dot form `git diff origin/main...HEAD`, which diffs against the merge base. The two-dot form, `origin/main..HEAD`, compares against the tip of `main`, so once `main` moves on it reports other people's changes as if they were yours.

Pre-commit checks look at staged files only (`git diff --cached`).
