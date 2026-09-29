#!/usr/bin/env bash
# Deploy and run the app on the Plex host over SSH. See docs/deploy-plex.md.
#
# Usage: scripts/deploy-plex.sh [--dry-run] [--host H] [--ref REF] [--dir DIR] [--port N] [-h|--help]
#
# Environment (flags win):
#   DEPLOY_HOST        SSH host                                   (default plex.lan)
#   DEPLOY_REF         git ref to deploy, resolved locally        (default origin/main)
#   DEPLOY_DIR         remote directory, relative to $HOME        (default kdef)
#   DEPLOY_PORT        host port for the app                      (default 8088; 8080 is taken on plex)
#   DEPLOY_MOUNT       NFS mount point on the host                (default /mnt/brenn)
#   DEPLOY_NAS_EXPORT  NFS export of the brenn share              (default 192.168.10.63:/Volume1/brenn)
#   DEPLOY_WAIT_SECS   how long to wait for /api/health           (default 300)
#   DEPLOY_SSH         ssh command                                (default "ssh -o BatchMode=yes -o ConnectTimeout=10")
#
# The script never runs sudo. If the NFS mount is missing it prints the commands for you to run by
# hand and exits 1. It never deletes the Postgres volume (it only ever runs `up`), and it only
# reads the KDEF share (the compose bind mount is :ro).
set -euo pipefail

host="${DEPLOY_HOST:-plex.lan}"
ref="${DEPLOY_REF:-origin/main}"
dir="${DEPLOY_DIR:-kdef}"
port="${DEPLOY_PORT:-8088}"
mount_dir="${DEPLOY_MOUNT:-/mnt/brenn}"
nas_export="${DEPLOY_NAS_EXPORT:-192.168.10.63:/Volume1/brenn}"
wait_secs="${DEPLOY_WAIT_SECS:-300}"
ssh_cmd="${DEPLOY_SSH:-ssh -o BatchMode=yes -o ConnectTimeout=10}"
# Fixed, so redeploys reuse the same Postgres volume (kdef-plex_pgdata).
project="kdef-plex"
dry_run=0

usage() { sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; }
die() { echo "deploy-plex: $*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) dry_run=1 ;;
    --host) host="${2:?--host needs a value}"; shift ;;
    --ref) ref="${2:?--ref needs a value}"; shift ;;
    --dir) dir="${2:?--dir needs a value}"; shift ;;
    --port) port="${2:?--port needs a value}"; shift ;;
    -h | --help) usage; exit 0 ;;
    *) usage >&2; die "unknown argument: $1" ;;
  esac
  shift
done

[[ "$port" =~ ^[0-9]+$ ]] || die "port must be a number, got: $port"
[[ "$dir" =~ ^[A-Za-z0-9._/-]+$ && "$dir" != /* ]] || die "remote dir must be a simple relative path, got: $dir"
IFS=/ read -r -a dir_parts <<<"$dir"
for part in "${dir_parts[@]}"; do
  [[ -n "$part" && "$part" != . && "$part" != .. ]] || die "remote dir must be a simple relative path (no '.', '..' or empty components), got: $dir"
done
[[ "$mount_dir" == /* ]] || die "DEPLOY_MOUNT must be an absolute path, got: $mount_dir"
kdef_dir="$mount_dir/KDEF"
fstab_line="$nas_export  $mount_dir  nfs  retry=10,nofail,nfsvers=4,ro,hard,noatime,rsize=1048576,wsize=1048576,_netdev  0  0"

read -r -a ssh_argv <<<"$ssh_cmd"

# rsh <args...>: run the script on stdin on the host, with the args as $1, $2, ...
rsh() {
  local quoted="" a
  for a in "$@"; do quoted+=" $(printf '%q' "$a")"; done
  "${ssh_argv[@]}" "$host" "bash -s --$quoted"
}

# rsh_c <script> <args...>: like rsh, but the script is an argument so stdin stays free for data.
rsh_c() {
  local script="$1" quoted="" a
  shift
  for a in "$@"; do quoted+=" $(printf '%q' "$a")"; done
  "${ssh_argv[@]}" "$host" "bash -c $(printf '%q' "$script") --$quoted"
}

repo_root="$(cd "$(dirname "$0")/.." && pwd)"

if [[ "$dry_run" == 1 ]]; then
  cat <<PLAN
deploy-plex (dry run; nothing is contacted or changed)
  1. resolve '$ref' to a commit in $repo_root (after 'git fetch origin' if the ref starts with origin/)
  2. ssh $host: preflight - docker, docker compose, curl; $mount_dir is a mount; $kdef_dir/angry is readable
     (if the mount is missing: print the mkdir / fstab / 'sudo mount' commands and exit 1; no sudo is run)
  3. git archive <commit> | ssh $host: extract into ~/$dir/src.new, swap into ~/$dir/src (source only; volumes untouched)
  4. ssh $host: cd ~/$dir/src && KDEF_HOST_DIR=$kdef_dir KDEF_PORT=$port docker compose -p $project up -d --build
  5. ssh $host: poll http://localhost:$port/api/health for up to ${wait_secs}s until images > 0
  6. print http://$host:$port
PLAN
  exit 0
fi

# ---- 1. resolve the ref ----
cd "$repo_root"
if [[ "$ref" == origin/* ]]; then
  git fetch --quiet origin || die "git fetch origin failed; cannot resolve $ref"
fi
commit="$(git rev-parse --verify --quiet "$ref^{commit}")" || die "cannot resolve git ref: $ref"
echo "deploy-plex: deploying $ref ($commit) to $host:~/$dir"

# ---- 2. preflight ----
# Exit codes from the remote script: 0 ok, 1 something missing, 3 the mount is missing.
echo "deploy-plex: preflight on $host"
rc=0
rsh "$mount_dir" "$kdef_dir" <<'REMOTE' || rc=$?
mount_dir="$1"; kdef_dir="$2"
problems=0
if command -v docker >/dev/null 2>&1; then
  if docker version --format '{{.Server.Version}}' >/dev/null 2>&1; then
    echo "ok: docker $(docker version --format '{{.Server.Version}}')"
  else
    echo "MISSING: docker is installed but the daemon is not reachable by this user"; problems=1
  fi
else
  echo "MISSING: docker is not installed"; problems=1
fi
if docker compose version >/dev/null 2>&1; then
  echo "ok: docker compose $(docker compose version --short)"
else
  echo "MISSING: docker compose plugin"; problems=1
fi
if command -v curl >/dev/null 2>&1; then echo "ok: curl"; else echo "MISSING: curl"; problems=1; fi
if ! mountpoint -q "$mount_dir" 2>/dev/null; then
  echo "MISSING: $mount_dir is not a mounted filesystem"
  exit 3
fi
echo "ok: $mount_dir is mounted"
# The mount is "hard", so an unreachable NAS would hang ls forever; cap it where timeout exists.
if [ -d "$kdef_dir/angry" ] && { if command -v timeout >/dev/null 2>&1; then timeout 20 ls "$kdef_dir/angry"; else ls "$kdef_dir/angry"; fi; } >/dev/null 2>&1; then
  echo "ok: $kdef_dir/angry is readable"
else
  echo "MISSING: $kdef_dir/angry is not readable (is this the brenn share, with a KDEF folder?)"; problems=1
fi
exit "$problems"
REMOTE
if [[ "$rc" == 3 ]]; then
  cat >&2 <<MSG

deploy-plex: the brenn share is not mounted on $host. This script never runs sudo.
Run these on $host (ssh $host), then re-run this script:

  sudo mkdir -p $mount_dir
  echo '$fstab_line' | sudo tee -a /etc/fstab
  sudo systemctl daemon-reload
  sudo mount $mount_dir
  ls $kdef_dir/angry | head -3

If the fstab line is already in /etc/fstab (grep brenn /etc/fstab), skip the 'tee' step.
The NAS must export $nas_export read-only to this host (check: showmount -e ${nas_export%%:*}).
MSG
  exit 1
elif [[ "$rc" == 255 ]]; then
  die "cannot reach $host over ssh (unreachable host or key auth failed); nothing was changed"
elif [[ "$rc" != 0 ]]; then
  die "preflight failed (see MISSING lines above); nothing was changed on $host"
fi

# ---- 3. sync the repo at the ref ----
# git archive over ssh: deploys exactly the commit (including one that is not pushed), needs no
# GitHub access or .git directory on the host, and leaves no local edits to conflict with.
# Only ~/$dir/src is replaced; Docker volumes live outside it.
echo "deploy-plex: syncing $commit"
# shellcheck disable=SC2016 # the script runs on the host, so $vars must not expand here
sync_script='set -euo pipefail
dir="$HOME/$1"
mkdir -p "$dir"
if [ -e "$dir/src" ] && [ ! -f "$dir/src/.deployed-sha" ]; then
  echo "deploy-plex: $dir/src exists but has no .deployed-sha marker, so this script did not create it; not replacing it. Use another --dir or move it away." >&2
  exit 1
fi
rm -rf "$dir/src.new"
mkdir "$dir/src.new"
tar -xf - -C "$dir/src.new"
if [ ! -f "$dir/src.new/docker-compose.yml" ]; then
  echo "deploy-plex: the archive did not contain docker-compose.yml; keeping the current src" >&2
  exit 1
fi
echo "$2" > "$dir/src.new/.deployed-sha"
rm -rf "$dir/src"
mv "$dir/src.new" "$dir/src"'
git archive --format=tar "$commit" | rsh_c "$sync_script" "$dir" "$commit"

# ---- 4. build and start ----
echo "deploy-plex: docker compose up (project $project)"
rsh "$dir" "$kdef_dir" "$port" "$project" <<'REMOTE'
set -euo pipefail
cd "$HOME/$1/src"
export KDEF_HOST_DIR="$2" KDEF_PORT="$3"
docker compose -p "$4" up -d --build
REMOTE

# ---- 5. wait for health ----
echo "deploy-plex: waiting up to ${wait_secs}s for /api/health with images > 0 (the first seed takes about a minute)"
rc=0
rsh "$port" "$wait_secs" "$dir" "$project" "$kdef_dir" <<'REMOTE' || rc=$?
port="$1"; wait_secs="$2"; dir="$3"; project="$4"; kdef_dir="$5"
deadline=$((SECONDS + wait_secs))
body=""
while [ "$SECONDS" -lt "$deadline" ]; do
  body="$(curl -fsS --max-time 5 "http://localhost:$port/api/health" 2>/dev/null || true)"
  if printf '%s' "$body" | grep -Eq '"images":[[:space:]]*[1-9][0-9]*'; then
    echo "health: $body"
    exit 0
  fi
  sleep 3
done
echo "last health response: ${body:-<none>}"
cd "$HOME/$dir/src"
KDEF_HOST_DIR="$kdef_dir" KDEF_PORT="$port" docker compose -p "$project" logs --tail 40 app || true
exit 1
REMOTE
[[ "$rc" == 0 ]] || die "app did not report images > 0 within ${wait_secs}s (app logs above)"

echo "deploy-plex: done. $ref ($commit) is running at http://$host:$port"
