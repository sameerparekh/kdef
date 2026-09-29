import type { FastifyInstance } from 'fastify';
import { CreatePlayerRequest, PLAYER_COLORS, type Player, type PlayerList } from '@kdef/shared';
import type { AppDeps } from '../app.js';
import { pickUniform } from '../adaptive/picker.js';
import { conflict, notFound, parseOr400 } from '../errors.js';
import { toPlayer } from '../stats/stats.js';
import { IdParams } from './params.js';

const UNIQUE_VIOLATION = '23505';

export function playerRoutes(app: FastifyInstance, { db, clock, rng }: AppDeps): void {
  app.get('/api/players', async (): Promise<PlayerList> => {
    const rows = await db
      .selectFrom('players')
      .selectAll()
      .orderBy('created_at')
      .orderBy('id')
      .execute();
    return { players: rows.map(toPlayer) };
  });

  app.post('/api/players', async (req, reply): Promise<Player> => {
    const body = parseOr400(CreatePlayerRequest, req.body);
    const color = body.color ?? pickUniform(PLAYER_COLORS, rng) ?? PLAYER_COLORS[0];
    try {
      const row = await db
        .insertInto('players')
        .values({ display_name: body.displayName, color, created_at: clock.now() })
        .returningAll()
        .executeTakeFirstOrThrow();
      return reply.status(201).send(toPlayer(row));
    } catch (err) {
      // players_display_name_lower_idx: unique on lower(display_name).
      if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
        throw conflict(`A player named "${body.displayName}" already exists`);
      }
      throw err;
    }
  });

  app.delete('/api/players/:id', async (req, reply) => {
    const { id } = parseOr400(IdParams, req.params);
    const deleted = await db
      .deleteFrom('players')
      .where('id', '=', id)
      .returning('id')
      .executeTakeFirst();
    if (!deleted) throw notFound('Player');
    return reply.status(204).send();
  });
}
