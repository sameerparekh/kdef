import { setupServer } from 'msw/node';

/** Shared MSW server; tests install handlers with `useMockApi()` or `server.use(...)`. */
export const server = setupServer();
