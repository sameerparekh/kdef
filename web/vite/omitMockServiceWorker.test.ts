import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';
import { omitMockServiceWorker } from './omitMockServiceWorker';

/**
 * The plugin must decide mock mode from the env Vite resolves (shell, `.env*` files and --mode),
 * which is what `import.meta.env.VITE_MOCK_API` in src/main.tsx reads.
 */
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function runBuild(env: Record<string, string>) {
  const outDir = mkdtempSync(join(tmpdir(), 'kdef-web-'));
  dirs.push(outDir);
  writeFileSync(join(outDir, 'mockServiceWorker.js'), '// worker');
  writeFileSync(join(outDir, 'other.txt'), 'kept');
  const plugin = omitMockServiceWorker() as Plugin & {
    configResolved: (c: ResolvedConfig) => void;
    closeBundle: { handler: () => void };
  };
  plugin.configResolved({ root: '/unused', build: { outDir }, env } as unknown as ResolvedConfig);
  plugin.closeBundle.handler();
  return {
    worker: existsSync(join(outDir, 'mockServiceWorker.js')),
    other: existsSync(join(outDir, 'other.txt')),
  };
}

describe('omitMockServiceWorker', () => {
  it('removes only the worker from a build without the mock flag', () => {
    expect(runBuild({})).toEqual({ worker: false, other: true });
    expect(runBuild({ VITE_MOCK_API: 'false' })).toEqual({ worker: false, other: true });
  });

  it('keeps the worker when the resolved env enables mock mode, wherever it came from', () => {
    expect(runBuild({ VITE_MOCK_API: 'true' })).toEqual({ worker: true, other: true });
  });
});
