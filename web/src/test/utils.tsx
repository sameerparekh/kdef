import type { Emotion, Player } from '@kdef/shared';
import { EMOTIONS } from '@kdef/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { StrictMode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../App';
import { createMockApi, type MockOptions } from '../mocks/mockApi';
import { server } from './server';

export const ALICE: Player = {
  id: '11111111-1111-4111-8111-111111111111',
  displayName: 'Alice',
  color: '#e11d48',
  createdAt: '2026-01-01T00:00:00.000Z',
};
export const BOB: Player = {
  id: '22222222-2222-4222-8222-222222222222',
  displayName: 'Bob',
  color: '#2563eb',
  createdAt: '2026-01-01T00:00:00.000Z',
};

/** Installs the in-memory mock API on the shared MSW server for this test. */
export function installMockApi(options: MockOptions = {}) {
  const api = createMockApi({ players: [ALICE, BOB], ...options });
  server.use(...api.handlers);
  return api;
}

/** Makes a GET endpoint hang forever, to observe the loading state. */
export function hang(path: string) {
  server.use(http.get(path, () => delay('infinite')));
}

/** Makes a GET endpoint fail with a 500 ApiError. */
export function fail(path: string, message = 'Database is on fire') {
  server.use(
    http.get(path, () => HttpResponse.json({ error: 'internal', message }, { status: 500 })),
  );
}

/** Renders the whole app (nav + routes) at a URL with a fresh query client. */
export function renderRoute(url: string, opts: { strict?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>
  );
  return render(opts.strict ? <StrictMode>{tree}</StrictMode> : tree);
}

/** A wrong answer for an emotion (any other emotion). */
export function otherThan(emotion: Emotion): Emotion {
  return EMOTIONS.find((e) => e !== emotion)!;
}

/** The first unanswered question of the first round, as the mock server sees it. */
export function currentQuestion(api: ReturnType<typeof createMockApi>) {
  const [round] = [...api.state.rounds.values()];
  const q = [...api.state.questions.values()].find((x) => x.roundId === round?.id && !x.chosen);
  if (!q) throw new Error('no unanswered question');
  return q;
}

/** Title-cased emotion, as shown on buttons. */
export function label(emotion: Emotion): string {
  return emotion[0]!.toUpperCase() + emotion.slice(1);
}
