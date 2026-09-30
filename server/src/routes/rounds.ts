import type { FastifyInstance } from 'fastify';
import {
  AnswerRequest,
  type AnswerResponse,
  type NextResponse,
  type Round,
  type RoundSummary,
} from '@kdef/shared';
import type { AppDeps } from '../app.js';
import { parseOr400 } from '../errors.js';
import { answerQuestion, nextQuestion, startRound } from '../quiz/service.js';
import { loadRound, roundEmotionTallies } from '../stats/stats.js';
import { IdParams } from './params.js';

export function roundRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.post('/api/players/:id/rounds', async (req, reply): Promise<Round> => {
    const { id } = parseOr400(IdParams, req.params);
    return reply.status(201).send(await startRound(deps, id));
  });

  app.get('/api/rounds/:id', async (req): Promise<RoundSummary> => {
    const { id } = parseOr400(IdParams, req.params);
    const round = await loadRound(deps.db, id);
    return { round, points: round.points, perEmotion: await roundEmotionTallies(deps.db, id) };
  });

  app.post('/api/rounds/:id/next', async (req): Promise<NextResponse> => {
    const { id } = parseOr400(IdParams, req.params);
    return nextQuestion(deps, id);
  });

  app.post('/api/questions/:id/answer', async (req): Promise<AnswerResponse> => {
    const { id } = parseOr400(IdParams, req.params);
    const body = parseOr400(AnswerRequest, req.body);
    return answerQuestion(deps, id, body.emotion, body.clientElapsedMs);
  });
}
