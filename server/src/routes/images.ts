import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app.js';
import { notFound } from '../errors.js';
import { IdParams } from './params.js';

/** Image bytes never change for a given id, so browsers may cache for a year. */
const IMAGE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** True when an If-None-Match header lists the given (quoted) etag. */
function etagMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header
    .split(',')
    .map((t) => t.trim().replace(/^W\//, ''))
    .some((t) => t === etag || t === '*');
}

export function imageRoutes(app: FastifyInstance, { db }: AppDeps): void {
  app.get('/api/images/:id', async (req, reply) => {
    const parsed = IdParams.safeParse(req.params);
    if (!parsed.success) throw notFound('Image');
    const row = await db
      .selectFrom('images')
      .select(['content', 'content_type', 'sha256'])
      .where('id', '=', parsed.data.id)
      .executeTakeFirst();
    if (!row) throw notFound('Image');

    const etag = `"${row.sha256}"`;
    reply.header('ETag', etag).header('Cache-Control', IMAGE_CACHE_CONTROL);
    if (etagMatches(req.headers['if-none-match'], etag)) return reply.status(304).send();
    return reply.type(row.content_type).send(row.content);
  });
}
