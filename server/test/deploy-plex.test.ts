import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// scripts/deploy-plex.sh talks to the host through DEPLOY_SSH. These tests point it at a fake ssh that
// runs the "remote" command on this machine and logs it, so the real script runs end to end without
// touching plex.lan. The mount path used is one that cannot exist, which is the missing-mount case.

const script = resolve(fileURLToPath(new URL('../../scripts/deploy-plex.sh', import.meta.url)));
const missingMount = '/nonexistent-kdef-test-mount';

let tmp: string;
let fakeSsh: string;
let sshLog: string;

function run(args: string[], env: Record<string, string> = {}) {
  const res = spawnSync(script, args, {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      DEPLOY_SSH: fakeSsh,
      DEPLOY_REF: 'HEAD',
      DEPLOY_MOUNT: missingMount,
      ...env,
    },
  });
  return { code: res.status, out: res.stdout, err: res.stderr };
}

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'deploy-plex-test-'));
  sshLog = join(tmp, 'ssh.log');
  fakeSsh = join(tmp, 'fake-ssh');
  // Called as: fake-ssh <host> "<remote command>". Runs the command locally, stdin passed through.
  writeFileSync(
    fakeSsh,
    `#!/usr/bin/env bash\nprintf '%s\\n' "$2" >> '${sshLog}'\nexec bash -c "$2"\n`,
  );
  chmodSync(fakeSsh, 0o755);
});

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('scripts/deploy-plex.sh', () => {
  it('stops at the preflight when the share is not mounted, prints the manual commands and exits non-zero', () => {
    const { code, out, err } = run([], { DEPLOY_HOST: 'plex.test' });
    expect(code).toBe(1);
    expect(out).toContain(`MISSING: ${missingMount} is not a mounted filesystem`);
    expect(err).toContain(`sudo mkdir -p ${missingMount}`);
    expect(err).toContain(
      `192.168.10.63:/Volume1/brenn  ${missingMount}  nfs  retry=10,nofail,nfsvers=4,ro,hard,noatime,rsize=1048576,wsize=1048576,_netdev  0  0`,
    );
    expect(err).toContain(`sudo mount ${missingMount}`);
    // Nothing after the preflight ran: no sync, no compose.
    expect(out).not.toContain('syncing');
    const log = readFileSync(sshLog, 'utf8');
    expect(log).not.toContain('up -d');
    expect(log).not.toContain('tar -xf');
  });

  it('never invokes sudo on the host', () => {
    run([], { DEPLOY_HOST: 'plex.test' });
    const remoteCommands = readFileSync(sshLog, 'utf8');
    expect(remoteCommands).not.toMatch(/\bsudo\b/);
  });

  it('--dry-run prints the plan and does not contact the host', () => {
    const marker = join(tmp, 'dry-run-ssh.log');
    const noSsh = join(tmp, 'no-ssh');
    writeFileSync(noSsh, `#!/usr/bin/env bash\ntouch '${marker}'\n`);
    chmodSync(noSsh, 0o755);
    const { code, out } = run(['--dry-run', '--port', '8099'], {
      DEPLOY_SSH: noSsh,
      DEPLOY_MOUNT: '/mnt/brenn',
    });
    expect(code).toBe(0);
    expect(out).toContain('dry run');
    expect(out).toContain(
      'KDEF_HOST_DIR=/mnt/brenn/KDEF KDEF_PORT=8099 docker compose -p kdef-plex up -d --build',
    );
    expect(out).toContain('http://plex.lan:8099');
    expect(existsSync(marker)).toBe(false);
  });

  it('never deletes the Postgres volume', () => {
    const text = readFileSync(script, 'utf8');
    expect(text).not.toMatch(/compose[^\n]*\bdown\b/);
    expect(text).not.toMatch(/volume\s+(rm|prune)/);
  });

  it('syncs the ref, runs compose with the fixed project and mount, and waits for health', () => {
    // Stub docker, mountpoint and curl on the "remote" PATH so the whole flow runs locally.
    const bin = join(tmp, 'bin');
    const home = join(tmp, 'home');
    const mount = join(tmp, 'mnt');
    const dockerLog = join(tmp, 'docker.log');
    mkdirSync(bin);
    mkdirSync(join(mount, 'KDEF', 'angry'), { recursive: true });
    mkdirSync(home);
    const stub = (name: string, body: string) => {
      writeFileSync(join(bin, name), `#!/usr/bin/env bash\n${body}\n`);
      chmodSync(join(bin, name), 0o755);
    };
    stub('mountpoint', 'exit 0');
    stub('curl', `echo '{"status":"ok","images":882}'`);
    stub(
      'docker',
      `echo "KDEF_HOST_DIR=$KDEF_HOST_DIR KDEF_PORT=$KDEF_PORT docker $*" >> '${dockerLog}'\n` +
        `case "$*" in "version --format"*) echo 29.0.0;; "compose version --short") echo 5.0.0;; esac`,
    );
    const { code, out } = run(['--port', '8099'], {
      DEPLOY_HOST: 'plex.test',
      DEPLOY_MOUNT: mount,
      HOME: home,
      PATH: `${bin}:${process.env.PATH ?? ''}`,
    });
    expect(code).toBe(0);
    expect(out).toContain('http://plex.test:8099');
    expect(readFileSync(dockerLog, 'utf8')).toContain(
      `KDEF_HOST_DIR=${mount}/KDEF KDEF_PORT=8099 docker compose -p kdef-plex up -d --build`,
    );
    expect(existsSync(join(home, 'kdef', 'src', 'docker-compose.yml'))).toBe(true);
    expect(readFileSync(join(home, 'kdef', 'src', '.deployed-sha'), 'utf8').trim()).toMatch(
      /^[0-9a-f]{40}$/,
    );
  });

  it('rejects an unusable remote directory', () => {
    const { code, err } = run(['--dir', '../etc'], { DEPLOY_HOST: 'plex.test' });
    expect(code).toBe(1);
    expect(err).toContain('remote dir must be a simple relative path');
  });
});
