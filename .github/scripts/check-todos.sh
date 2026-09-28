#!/usr/bin/env bash
# Every deferral marker must link a GitHub issue: TODO(#123): ...
# Rejects bare TODO / FIXME / XXX / HACK / DEFERRED in tracked source files.
set -euo pipefail

hits="$(git grep -nE '\b(TODO|FIXME|XXX|HACK|DEFERRED)\b' -- \
  ':!*.md' ':!package-lock.json' ':!.github/scripts/check-todos.sh' \
  | grep -vE '\b(TODO|FIXME|XXX|HACK|DEFERRED)\(#[0-9]+\)' || true)"

if [[ -n "${hits}" ]]; then
  echo "Deferral markers without a linked issue (use TODO(#<issue>): ...):" >&2
  echo "${hits}" >&2
  exit 1
fi
echo "No unlinked TODO markers."
