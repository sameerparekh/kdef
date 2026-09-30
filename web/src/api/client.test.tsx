import { NoContent } from '@kdef/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { ALICE, installMockApi } from '../test/utils';
import { request } from './client';
import { useCreatePlayer, useCurrentQuestion, useDeletePlayer, useStartRound } from './queries';

/** The server answers 400 to a JSON content-type with an empty body, so bodyless calls must not send one. */
function recordHeaders() {
  const seen: Array<{ call: string; contentType: string | null }> = [];
  server.events.on('request:start', ({ request: r }) => {
    seen.push({
      call: `${r.method} ${new URL(r.url).pathname}`,
      contentType: r.headers.get('content-type'),
    });
  });
  return seen;
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('request content-type', () => {
  it('is omitted for start round, /next and delete, which send no body', async () => {
    const api = installMockApi();
    const seen = recordHeaders();

    const start = renderHook(() => useStartRound(), { wrapper });
    start.result.current.mutate(ALICE.id);
    await waitFor(() => expect(start.result.current.isSuccess).toBe(true));
    const roundId = start.result.current.data!.id;

    const next = renderHook(() => useCurrentQuestion(roundId), { wrapper });
    await waitFor(() => expect(next.result.current.isSuccess).toBe(true));

    const del = renderHook(() => useDeletePlayer(), { wrapper });
    del.result.current.mutate(ALICE.id);
    await waitFor(() => expect(del.result.current.isSuccess).toBe(true));

    expect(api.state.players.map((p) => p.id)).not.toContain(ALICE.id);
    expect(seen.map((s) => s.call)).toEqual([
      `POST /api/players/${ALICE.id}/rounds`,
      `POST /api/rounds/${roundId}/next`,
      `DELETE /api/players/${ALICE.id}`,
    ]);
    expect(seen.map((s) => s.contentType)).toEqual([null, null, null]);
  });

  it('is application/json when there is a body', async () => {
    installMockApi();
    const seen = recordHeaders();
    const create = renderHook(() => useCreatePlayer(), { wrapper });
    create.result.current.mutate({ displayName: 'Carol' });
    await waitFor(() => expect(create.result.current.isSuccess).toBe(true));
    expect(seen).toEqual([{ call: 'POST /api/players', contentType: 'application/json' }]);
  });
});

describe('204 responses', () => {
  it('parse with the shared NoContent schema', async () => {
    installMockApi();
    await expect(
      request(NoContent, `/api/players/${ALICE.id}`, { method: 'DELETE' }),
    ).resolves.toBeNull();
  });
});
