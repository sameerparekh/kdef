# Deploy to the Plex host

`scripts/deploy-plex.sh` runs the app on `plex.lan` (Ubuntu, Docker + Compose) over SSH. The KDEF photos come from the NAS `brenn` share, mounted read-only over NFS. The images are loaded into Postgres on the first start and are not read again after that.

## One-time host prep (by hand)

The script never runs `sudo`, so mounting the share is a manual step.

1. On the NAS (TNAS-A6E3, 192.168.10.63), export `/Volume1/brenn` read-only to the Plex host (192.168.10.43) in the NAS UI. Check from any machine: `showmount -e 192.168.10.63`.
2. On the Plex host:

```
sudo mkdir -p /mnt/brenn
echo '192.168.10.63:/Volume1/brenn  /mnt/brenn  nfs  retry=10,nofail,nfsvers=4,ro,hard,noatime,rsize=1048576,wsize=1048576,_netdev  0  0' | sudo tee -a /etc/fstab
sudo systemctl daemon-reload
sudo mount /mnt/brenn
ls /mnt/brenn/KDEF/angry | head -3
```

The fstab line follows the existing `/mnt/media` entry. If the mount is missing when you deploy, the script prints exactly these commands and exits 1.

## Deploy

From a checkout on your machine:

```
scripts/deploy-plex.sh                    # deploy origin/main
scripts/deploy-plex.sh --ref my-branch    # any local ref (a commit that is not pushed works too)
scripts/deploy-plex.sh --dry-run          # print the plan; contacts nothing
```

Then open `http://plex.lan:8088`. Options (flags win over environment variables):

| flag | env | default |
|---|---|---|
| `--host` | `DEPLOY_HOST` | `plex.lan` |
| `--ref` | `DEPLOY_REF` | `origin/main` |
| `--dir` | `DEPLOY_DIR` | `kdef` (under `$HOME` on the host) |
| `--port` | `DEPLOY_PORT` | `8088` |
| | `DEPLOY_MOUNT` | `/mnt/brenn` |
| | `DEPLOY_WAIT_SECS` | `300` |

Port 8080 is taken on the Plex host (the wifihaven API), hence 8088. Postgres is published on the host's `127.0.0.1:55432` only, as in the local stack.

What it does, in order:

1. Resolves the ref to a commit locally (`git fetch origin` first when the ref starts with `origin/`).
2. Preflight over SSH: Docker and Compose present, `/mnt/brenn` is a mount, `/mnt/brenn/KDEF/angry` is readable. If not, it stops before changing anything.
3. Sends `git archive <commit>` over SSH and swaps it into `~/kdef/src`. This is used instead of a clone on the host because it deploys exactly that commit (including an unpushed one), needs no GitHub access from the host, and leaves no working tree to drift. `~/kdef/src/.deployed-sha` records what is running.
4. Runs `docker compose -p kdef-plex up -d --build` with `KDEF_HOST_DIR=/mnt/brenn/KDEF` and the port.
5. Polls `/api/health` on the host until it reports `images > 0`. The first seed takes about a minute over NFS. On timeout it prints the app logs and exits 1.

## Safety

- Idempotent: rerun it any time. The compose project name is always `kdef-plex`, so the Postgres volume (`kdef-plex_pgdata`) is reused and players and history survive a redeploy.
- It never deletes the volume: the script only runs `up`, never `down -v` or `volume rm`. To wipe the data on purpose, do it by hand on the host.
- The share is mounted `ro` on the host and bind-mounted `:ro` into the container.
- It touches only `~/kdef` and the `kdef-plex` compose project on the host. Other containers and mounts (`/mnt/media`, downloads, backups) are left alone.
- The app has no authentication, so it is reachable by anything on the LAN at the port above.
