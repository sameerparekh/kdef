import {
  AnswerResponse,
  ApiError,
  AnswerRequest,
  CreatePlayerRequest,
  LOAD_ALLOWANCE_MS,
  MAX_CLIENT_ELAPSED_MS,
  formatZodIssues,
  pointsFor,
} from '@kdef/shared';
import { describe, expect, it } from 'vitest';
import { ALICE, installMockApi } from '../test/utils';

/**
 * The mock must answer errors the way the real server does, so a web test that passes on
 * the mock cannot hide a code or message the server never sends. Expected values are the
 * ones in server/src/errors.ts (`notFound`, `conflict`, `parseOr400`), server/src/quiz/service.ts,
 * server/src/stats/stats.ts and server/src/routes/players.ts.
 */
const MISSING = '00000000-0000-4000-8000-00000000ffff';

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json: unknown = await res.json();
  return { status: res.status, body: res.ok ? null : ApiError.parse(json) };
}

describe('mock API errors match the server', () => {
  it('409 conflict for a duplicate player name', async () => {
    installMockApi();
    const res = await call('POST', '/api/players', { displayName: 'alice' });
    expect(res).toEqual({
      status: 409,
      body: { error: 'conflict', message: 'A player named "alice" already exists' },
    });
  });

  it('404 "Player not found" for delete, start round and stats', async () => {
    installMockApi();
    const notFound = { error: 'not_found', message: 'Player not found' };
    for (const [method, path] of [
      ['DELETE', `/api/players/${MISSING}`],
      ['POST', `/api/players/${MISSING}/rounds`],
      ['GET', `/api/players/${MISSING}/stats`],
    ] as const) {
      expect(await call(method, path), `${method} ${path}`).toEqual({
        status: 404,
        body: notFound,
      });
    }
  });

  it('404 "Round not found" for next and round summary', async () => {
    installMockApi();
    const notFound = { error: 'not_found', message: 'Round not found' };
    expect(await call('POST', `/api/rounds/${MISSING}/next`)).toEqual({
      status: 404,
      body: notFound,
    });
    expect(await call('GET', `/api/rounds/${MISSING}`)).toEqual({ status: 404, body: notFound });
  });

  it('404 "Question not found" and 409 conflict for a repeated answer', async () => {
    const api = installMockApi({ roundLength: 2 });
    expect(await call('POST', `/api/questions/${MISSING}/answer`, { emotion: 'happy' })).toEqual({
      status: 404,
      body: { error: 'not_found', message: 'Question not found' },
    });
    await call('POST', `/api/players/${ALICE.id}/rounds`);
    const [q] = [...api.state.questions.values()];
    await call('POST', `/api/questions/${q!.id}/answer`, { emotion: 'happy' });
    expect(await call('POST', `/api/questions/${q!.id}/answer`, { emotion: 'happy' })).toEqual({
      status: 409,
      body: { error: 'conflict', message: 'This question has already been answered' },
    });
  });

  it('400 bad_request with the same text the server builds from the shared schema issues', async () => {
    installMockApi();
    const bad = [
      ['/api/players', CreatePlayerRequest, { displayName: '   ' }],
      [`/api/questions/${MISSING}/answer`, AnswerRequest, { emotion: 'nope' }],
      ['/api/players', CreatePlayerRequest, 'not an object'],
    ] as const;
    for (const [path, schema, body] of bad) {
      const res = await call('POST', path, body);
      const issues = schema.safeParse(body).error!.issues;
      expect(res).toEqual({
        status: 400,
        body: { error: 'bad_request', message: formatZodIssues(issues) },
      });
    }
  });
});

describe('mock API scoring uses the shared formula', () => {
  /** Starts a round, lets `serverMs` pass on the mock's clock, answers, and returns the response. */
  async function answerAfter(serverMs: number, body: Record<string, unknown>, hit: boolean) {
    let t = 1_000;
    const api = installMockApi({ roundLength: 2, clock: () => t });
    await call('POST', `/api/players/${ALICE.id}/rounds`);
    await call('POST', `/api/rounds/${[...api.state.rounds.keys()][0]}/next`);
    const q = [...api.state.questions.values()][0]!;
    t += serverMs;
    const emotion = hit ? q.emotion : q.emotion === 'happy' ? 'sad' : 'happy';
    const res = await fetch(`/api/questions/${q.id}/answer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ emotion, ...body }),
    });
    return { res, api, parsed: res.ok ? AnswerResponse.parse(await res.json()) : null };
  }

  it('scores a hit from the server-measured time when the client sends none', async () => {
    const { parsed } = await answerAfter(5000, {}, true);
    expect(parsed?.points).toBe(pointsFor(true, 5000));
    expect(parsed?.points).toBe(50);
  });

  it('uses the client time, clamped to the load allowance below the server time', async () => {
    const ok = await answerAfter(6000, { clientElapsedMs: 5000 }, true);
    expect(ok.parsed?.points).toBe(50);
    const tooFast = await answerAfter(9000, { clientElapsedMs: 0 }, true);
    expect(tooFast.parsed?.points).toBe(pointsFor(true, 9000 - LOAD_ALLOWANCE_MS));
    const tooSlow = await answerAfter(3000, { clientElapsedMs: 30_000 }, true);
    expect(tooSlow.parsed?.points).toBe(pointsFor(true, 3000));
  });

  it('scores a miss 0 and keeps the round total', async () => {
    const { parsed, api } = await answerAfter(100, {}, false);
    expect(parsed?.points).toBe(0);
    expect([...api.state.rounds.values()][0]?.points).toBe(0);
  });

  it('rejects a client time above the cap like the server', async () => {
    const { res } = await answerAfter(100, { clientElapsedMs: MAX_CLIENT_ELAPSED_MS + 1 }, true);
    expect(res.status).toBe(400);
  });
});
