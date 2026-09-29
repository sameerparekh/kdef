/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * public/ is copied into every build, so assets added there later ship. The exception is MSW's
 * mockServiceWorker.js, which only a build made for mock mode (VITE_MOCK_API=true) should carry;
 * this removes it from the output of any other build.
 */
function omitMockServiceWorker(): Plugin {
  let outDir = '';
  return {
    name: 'kdef:omit-mock-service-worker',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle: {
      order: 'post',
      handler() {
        if (process.env.VITE_MOCK_API !== 'true') {
          rmSync(resolve(outDir, 'mockServiceWorker.js'), { force: true });
        }
      },
    },
  };
}

export default defineConfig({
  plugins: [react(), omitMockServiceWorker()],
  server: {
    port: 5173,
    // All interfaces, for testing from phones/tablets on the LAN. On an untrusted network run
    // `npm run dev -w web -- --host 127.0.0.1`: this server and its /api proxy are otherwise exposed.
    host: true,
    // In dev the API runs separately (npm run dev -w server); in Docker it serves the SPA itself.
    proxy: { '/api': 'http://localhost:8080' },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
});
