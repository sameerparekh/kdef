# Worktrees for spawned work

Any spawned agent or session that edits files works in its own git worktree, never the top-level checkout, because the top-level checkout is usually on some other in-flight branch.

```
git fetch origin
git worktree add .claude/worktrees/<slug> -b <branch> origin/main
cd .claude/worktrees/<slug> && git log --oneline origin/main..HEAD   # must be empty
```

- Branch from `origin/main`, never from the parent's `HEAD`.
- With the Agent tool's `isolation: "worktree"`, the worktree starts on the parent's branch. So first run `git fetch origin && git reset --hard origin/main`; this is safe only because the worktree is fresh.
- Never push, or check out branches, in the top-level checkout from a spawned session.
- Each worktree needs `npm install`. The test Postgres (`npm run db:up`, port 55432) is shared, and each test file creates its own database, so parallel worktrees don't collide.
