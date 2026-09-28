import type { FastifyInstance } from 'fastify';
import type { Health } from '@kdef/shared';
import type { AppDeps } from '../app.js';

export function healthRoutes(app: FastifyInstance, { db }: AppDeps): void {
  app.get('/api/health', async (): Promise<Health> => {
    const row = await db
      .selectFrom('images')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .executeTakeFirstOrThrow();
    return { status: 'ok', images: Number(row.n) };
  });
}
