#!/usr/bin/env bash
# Regenerate seed/angles.csv from a local KDEF checkout (dev-only; needs Docker).
# Usage: scripts/classify-angles.sh [KDEF_DIR]   (default: $KDEF_DIR or /Volumes/brenn/KDEF)
# Set YAW_JSON_DIR to also dump the raw per-photo yaw estimates there (for debugging).
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
kdef="${1:-${KDEF_DIR:-/Volumes/brenn/KDEF}}"
docker build -q -t kdef-classify-angles -f "$root/scripts/classify-angles.Dockerfile" "$root/scripts"
if [[ -n "${YAW_JSON_DIR:-}" ]]; then
  docker run --rm -v "$kdef:/data/kdef:ro" -v "$root/seed:/out" -v "$YAW_JSON_DIR:/yaw" \
    kdef-classify-angles /data/kdef /out/angles.csv --yaw-json /yaw/yaw.json
else
  docker run --rm -v "$kdef:/data/kdef:ro" -v "$root/seed:/out" \
    kdef-classify-angles /data/kdef /out/angles.csv
fi
