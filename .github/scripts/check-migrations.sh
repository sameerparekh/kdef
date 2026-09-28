#!/usr/bin/env bash
# Migrations are immutable once merged: reject modified/deleted/renamed files under
# db/migrations relative to the merge base, and reject duplicate version numbers.
# See docs/process/migrations.md. Usage: check-migrations.sh <base-ref>
set -euo pipefail

BASE="${1:?usage: check-migrations.sh <base-ref>}"
DIR="db/migrations"
bad=0

# Three-dot: diff against the merge base, not the tip of base (docs/process/branch-diff-checks.md).
changes="$(git diff --name-status "${BASE}"...HEAD -- "${DIR}")"
while IFS= read -r line; do
  [[ -z "${line}" ]] && continue
  status="$(cut -f1 <<<"${line}")"
  files="$(cut -f2- <<<"${line}")"
  if [[ "${status}" == "A" ]]; then
    echo "OK (added): ${files}"
  else
    echo "BLOCKED (${status}): ${files} — merged migrations must not change; add a new V<n>__ file." >&2
    bad=1
  fi
done <<<"${changes}"

dups="$(find "${DIR}" -maxdepth 1 -name 'V*__*.sql' | sed -E 's#.*/V([0-9]+)__.*#\1#' | sort | uniq -d)"
if [[ -n "${dups}" ]]; then
  echo "BLOCKED: duplicate migration version(s): ${dups}" >&2
  bad=1
fi

exit "${bad}"
