import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

/**
 * public/ is copied into every build, so assets added there later ship. The exception is MSW's
 * mockServiceWorker.js, which only a build made for mock mode should carry; this removes it from
 * the output of any other build. Mock mode is read from the env Vite resolves (shell, `.env*`
 * files, --mode), the same source as `import.meta.env.VITE_MOCK_API` in src/main.tsx.
 */
export function omitMockServiceWorker(): Plugin {
  let outDir = '';
  let mock = false;
  return {
    name: 'kdef:omit-mock-service-worker',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
      mock = config.env.VITE_MOCK_API === 'true';
    },
    closeBundle: {
      order: 'post',
      handler() {
        if (!mock) rmSync(resolve(outDir, 'mockServiceWorker.js'), { force: true });
      },
    },
  };
}
