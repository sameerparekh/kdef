import type { FastifyInstance } from 'fastify';
import type { Leaderboard, PlayerStats } from '@kdef/shared';
import type { AppDeps } from '../app.js';
import { parseOr400 } from '../errors.js';
import { leaderboard, playerStats } from '../stats/stats.js';
import { IdParams } from './params.js';

export function statsRoutes(app: FastifyInstance, { db }: AppDeps): void {
  app.get('/api/players/:id/stats', async (req): Promise<PlayerStats> => {
    const { id } = parseOr400(IdParams, req.params);
    return playerStats(db, id);
  });

  app.get('/api/leaderboard', async (): Promise<Leaderboard> => leaderboard(db));
}
