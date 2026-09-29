#!/usr/bin/env bash
# Regenerate seed/angles.csv from a local KDEF checkout (dev-only; needs Docker).
# Usage: scripts/classify-angles.sh [KDEF_DIR]   (default: $KDEF_DIR or /Volumes/brenn/KDEF)
# Optional, both write outside the repo and must never be committed:
#   CONTACT_SHEET_DIR=<dir>  also write <dir>/angles-contact-sheet.html for spot-checking
#                            (images load from file://KDEF_DIR, so open it on this machine)
#   YAW_JSON_DIR=<dir>       also dump the raw per-photo yaw estimates to <dir>/yaw.json
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
kdef="${1:-${KDEF_DIR:-/Volumes/brenn/KDEF}}"
mounts=(-v "$kdef:/data/kdef:ro" -v "$root/seed:/out")
args=(/data/kdef /out/angles.csv)
if [[ -n "${YAW_JSON_DIR:-}" ]]; then
  mounts+=(-v "$YAW_JSON_DIR:/yaw")
  args+=(--yaw-json /yaw/yaw.json)
fi
if [[ -n "${CONTACT_SHEET_DIR:-}" ]]; then
  mounts+=(-v "$CONTACT_SHEET_DIR:/sheet")
  args+=(--contact-sheet /sheet/angles-contact-sheet.html --image-base-url "file://$kdef")
fi
docker build -q -t kdef-classify-angles -f "$root/scripts/classify-angles.Dockerfile" "$root/scripts"
docker run --rm "${mounts[@]}" kdef-classify-angles "${args[@]}"
