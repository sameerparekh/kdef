/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { omitMockServiceWorker } from './vite/omitMockServiceWorker';

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
