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
