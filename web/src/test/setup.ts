import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from './server';

// Node's fetch rejects relative URLs; resolve them against the jsdom origin, as a browser would.
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) =>
  nativeFetch(
    typeof input === 'string' && input.startsWith('/') ? location.origin + input : input,
    init,
  );

// jsdom has no ResizeObserver, which recharts' ResponsiveContainer needs. Charts have no size
// in jsdom, so tests assert on the accessible table that accompanies each chart.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  try {
    localStorage.clear();
  } catch {
    /* storage unavailable */
  }
});
afterAll(() => server.close());
