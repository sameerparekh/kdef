/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  // public/ holds only MSW's mockServiceWorker.js: ship it in dev, or in a build made for mock mode.
  publicDir: command === 'serve' || process.env.VITE_MOCK_API === 'true' ? 'public' : false,
  plugins: [react()],
  server: {
    port: 5173,
    // In dev the API runs separately (npm run dev -w server); in Docker it serves the SPA itself.
    proxy: { '/api': 'http://localhost:8080' },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
}));
