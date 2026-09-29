import { defineConfig, devices } from '@playwright/test';

/** Must match the port published by e2e/docker-compose.e2e.yml. */
export const BASE_URL = 'http://localhost:18080';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  // One stateful flow against one database: no parallelism, no retries hiding flakes.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { outputFolder: '../playwright-report', open: 'never' }]],
  outputDir: '../test-results',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
