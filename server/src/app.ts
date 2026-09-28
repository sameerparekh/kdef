import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import type { ApiError } from '@kdef/shared';
import type { Clock } from './clock.js';
import type { Config } from './config.js';
import type { Db } from './db/connect.js';
import { HttpError } from './errors.js';
import type { Rng } from './rng.js';
import { healthRoutes } from './routes/health.js';

/** Everything a route may depend on. Tests pass a TestClock and seededRng. */
export interface AppDeps {
  db: Db;
  clock: Clock;
  rng: Rng;
}

export interface BuildAppOptions {
  logLevel?: Config['logLevel'] | 'silent';
  spa?: Config['spa'];
}

export async function buildApp(
  deps: AppDeps,
  opts: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: opts.logLevel ?? 'info' } });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      const body: ApiError = { error: err.code, message: err.message };
      return reply.status(err.statusCode).send(body);
    }
    req.log.error({ err }, 'unhandled error');
    const body: ApiError = { error: 'internal', message: 'Internal server error' };
    return reply.status(500).send(body);
  });

  healthRoutes(app, deps);

  if (opts.spa?.enabled) {
    await app.register(fastifyStatic, { root: opts.spa.distDir, wildcard: false });
    // Client-side routing: any non-API GET falls back to index.html.
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) {
        return reply.sendFile('index.html');
      }
      const body: ApiError = { error: 'not_found', message: `${req.method} ${req.url} not found` };
      return reply.status(404).send(body);
    });
  }

  return app;
}
