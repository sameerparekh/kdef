#!/usr/bin/env bash
# `npm run e2e`: build and start the real Docker stack under its own compose project, run the
# Playwright smoke test against it, and always tear it down (including volumes).
set -euo pipefail

cd "$(dirname "$0")/.."

export E2E_COMPOSE_PROJECT="${E2E_COMPOSE_PROJECT:-kdef-e2e}"
export KDEF_HOST_DIR="$PWD/e2e/fixtures/kdef"
compose=(docker compose -p "$E2E_COMPOSE_PROJECT" -f docker-compose.yml -f e2e/docker-compose.e2e.yml)

cleanup() {
  status=$?
  if [[ $status -ne 0 ]]; then
    echo "--- e2e failed; app logs ---" >&2
    "${compose[@]}" logs --no-color app >&2 || true
  fi
  "${compose[@]}" down -v --remove-orphans || true
  exit "$status"
}
trap cleanup EXIT

npm run build -w shared
"${compose[@]}" down -v --remove-orphans
"${compose[@]}" up -d --build --wait --wait-timeout 600
npx playwright test -c e2e/playwright.config.ts "$@"
