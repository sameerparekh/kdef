import { ApiError } from '@kdef/shared';
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
  return { status: res.status, body: ApiError.parse(await res.json()) };
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

  it('400 bad_request with "path: message" issues, as parseOr400 formats them', async () => {
    installMockApi();
    const name = await call('POST', '/api/players', { displayName: '   ' });
    expect(name.status).toBe(400);
    expect(name.body.error).toBe('bad_request');
    expect(name.body.message).toMatch(/^displayName: /);
    const answer = await call('POST', `/api/questions/${MISSING}/answer`, { emotion: 'nope' });
    expect(answer.status).toBe(400);
    expect(answer.body.message).toMatch(/^emotion: /);
    const notObject = await call('POST', '/api/players', 'not an object');
    expect(notObject.body.message).toMatch(/^\(body\): /);
  });
});
