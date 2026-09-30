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
// runs the "remote" command on this machine and logs it (the command line and any text on stdin, which
// is where the remote scripts travel), so the real script runs end to end without touching plex.lan.
// The default mount path used is one that cannot exist, which is the missing-mount case.

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
  writeFileSync(sshLog, '');
  fakeSsh = join(tmp, 'fake-ssh');
  // Called as: fake-ssh <host> "<remote command>". Text on stdin (the remote scripts) is logged too;
  // binary stdin (the tar stream) is not. FAKE_SSH_EXIT makes it fail like an unreachable host.
  writeFileSync(
    fakeSsh,
    [
      '#!/usr/bin/env bash',
      'if [[ -n "${FAKE_SSH_EXIT:-}" ]]; then exit "$FAKE_SSH_EXIT"; fi',
      'in="$(mktemp)"',
      'cat > "$in"',
      `{ printf '%s\\n' "$2"; if grep -Iq . "$in"; then cat "$in"; fi; } >> '${sshLog}'`,
      'exec bash -c "$2" < "$in"',
      '',
    ].join('\n'),
  );
  chmodSync(fakeSsh, 0o755);
});

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

// A fake host: docker, mountpoint and curl stubs first on the "remote" PATH, its own HOME and mount.
function fakeHost(name: string) {
  const root = join(tmp, name);
  const bin = join(root, 'bin');
  const home = join(root, 'home');
  const mount = join(root, 'mnt');
  const dockerLog = join(root, 'docker.log');
  mkdirSync(bin, { recursive: true });
  mkdirSync(join(mount, 'KDEF', 'angry'), { recursive: true });
  mkdirSync(home);
  const stub = (n: string, body: string) => {
    writeFileSync(join(bin, n), `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(join(bin, n), 0o755);
  };
  stub('mountpoint', 'exit 0');
  stub('curl', `echo '{"status":"ok","images":882}'`);
  stub(
    'docker',
    `echo "\${KDEF_HOST_DIR:+KDEF_HOST_DIR=$KDEF_HOST_DIR }\${KDEF_PORT:+KDEF_PORT=$KDEF_PORT }docker $*" >> '${dockerLog}'\n` +
      `case "$*" in "version --format"*) echo 29.0.0;; "compose version --short") echo 5.0.0;; esac`,
  );
  const env = {
    DEPLOY_HOST: 'plex.test',
    DEPLOY_MOUNT: mount,
    HOME: home,
    PATH: `${bin}:${process.env.PATH ?? ''}`,
  };
  return { home, mount, dockerLog, env };
}

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
    expect(log).toContain('mountpoint'); // the remote script text is logged, so the checks below can fail
    expect(log).not.toContain('up -d');
    expect(log).not.toContain('tar -xf');
    expect(log).not.toMatch(/\bsudo\b/);
  });

  it('explains an ssh connection failure (exit 255) instead of blaming the mount', () => {
    const { code, err } = run([], { DEPLOY_HOST: 'plex.test', FAKE_SSH_EXIT: '255' });
    expect(code).toBe(1);
    expect(err).toContain('cannot reach plex.test over ssh');
    expect(err).not.toContain('MISSING');
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
    const h = fakeHost('happy');
    const { code, out } = run(['--port', '8099'], h.env);
    expect(code).toBe(0);
    expect(out).toContain('http://plex.test:8099');
    expect(existsSync(join(h.home, 'kdef', 'src', 'docker-compose.yml'))).toBe(true);
    expect(readFileSync(join(h.home, 'kdef', 'src', '.deployed-sha'), 'utf8').trim()).toMatch(
      /^[0-9a-f]{40}$/,
    );
    // Allowlist of every docker call the deploy may make. down, rm, prune, up -V ... would all fail here.
    const env = `KDEF_HOST_DIR=${h.mount}/KDEF KDEF_PORT=8099 docker compose -p kdef-plex`;
    const allowed = new Set([
      'docker version --format {{.Server.Version}}',
      'docker compose version',
      'docker compose version --short',
      `${env} up -d --build`,
      `${env} logs --tail 40 app`,
    ]);
    const lines = readFileSync(h.dockerLog, 'utf8').trim().split('\n');
    for (const line of lines)
      expect(allowed.has(line), `unexpected docker call: ${line}`).toBe(true);
    expect(lines).toContain(`${env} up -d --build`);
    expect(readFileSync(sshLog, 'utf8')).not.toMatch(/\bsudo\b/);
  });

  it('redeploys over its own previous deploy', () => {
    const h = fakeHost('redeploy');
    expect(run([], h.env).code).toBe(0);
    expect(run([], h.env).code).toBe(0);
  });

  it('refuses to replace a src directory it did not create', () => {
    const h = fakeHost('foreign');
    mkdirSync(join(h.home, 'kdef', 'src'), { recursive: true });
    writeFileSync(join(h.home, 'kdef', 'src', 'mine.txt'), 'keep');
    const { code, err } = run([], h.env);
    expect(code).not.toBe(0);
    expect(err).toContain('.deployed-sha');
    expect(readFileSync(join(h.home, 'kdef', 'src', 'mine.txt'), 'utf8')).toBe('keep');
    expect(existsSync(h.dockerLog) ? readFileSync(h.dockerLog, 'utf8') : '').not.toContain('up -d');
  });

  it.each(['../etc', '.', './', 'a/./b', 'a/..', '/abs', 'has space'])(
    'rejects the unusable remote directory %j',
    (dir) => {
      const { code, err } = run(['--dir', dir], { DEPLOY_HOST: 'plex.test' });
      expect(code).toBe(1);
      expect(err).toContain('remote dir must be a simple relative path');
    },
  );
});
