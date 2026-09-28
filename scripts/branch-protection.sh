#!/usr/bin/env bash
# Declarative branch protection for main (docs/process/declarative-config.md).
# Re-run after changing it; the repo settings UI is not the source of truth.
set -euo pipefail
REPO="${1:-sameerparekh/kdef}"

gh api -X PUT "repos/${REPO}/branches/main/protection" --input - <<'JSON'
{
  "required_status_checks": { "strict": true, "contexts": ["CI"] },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_linear_history": true
}
JSON

gh api -X PATCH "repos/${REPO}" \
  -f allow_squash_merge=true -f allow_merge_commit=false -f allow_rebase_merge=false \
  -f delete_branch_on_merge=true >/dev/null
echo "Branch protection applied to ${REPO}:main"
