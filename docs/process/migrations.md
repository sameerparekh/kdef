# Migrations

- **Files:** `db/migrations/V<n>__<snake_name>.sql`. `server/src/db/migrate.ts` applies them in order at boot, each in a transaction, and records version and sha256 checksum in `schema_migrations`. A Postgres advisory lock serialises concurrent boots.
- **Immutable once merged.** Never edit, rename or delete a merged migration; add `V<n+1>__…`.
  - The runner refuses to boot when an applied migration's checksum changed.
  - `.github/scripts/check-migrations.sh origin/main` rejects anything but added files in a PR, and rejects duplicate versions. It runs in CI and in `pre-push`.
- **One schema source.** Tests migrate their databases with the same files, and nothing builds tables by hand.
- **Keep `server/src/db/schema.ts` in step.** Update the Kysely types in the same PR as the migration. The migration is authoritative; the types describe it.
- **Before merge**, a migration that touches `questions` (the only table that grows without bound) should say in the PR how it behaves on a large table.
