import { buildApp } from './app.js';
import { liveClock } from './clock.js';
import { ConfigError, loadConfig } from './config.js';
import { connect } from './db/connect.js';
import { migrate } from './db/migrate.js';
import { liveRng } from './rng.js';
import { ensureImagesSeeded } from './seed/index.js';

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const { applied } = await migrate(config.databaseUrl);

  const db = connect(config.databaseUrl);
  const app = await buildApp(
    { db, clock: liveClock, rng: liveRng },
    { logLevel: config.logLevel, spa: config.spa },
  );
  app.log.info(
    { migrationsApplied: applied, serveSpa: config.spa.enabled },
    'startup: migrations done',
  );

  await ensureImagesSeeded({
    db,
    clock: liveClock,
    kdefDir: config.kdefDir,
    manifestPath: config.seedManifestPath,
    log: (line) => app.log.info(line),
  });

  const shutdown = async () => {
    await app.close();
    await db.destroy();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await app.listen({ port: config.port, host: config.host });
}

main().catch((err: unknown) => {
  if (err instanceof ConfigError) {
    console.error(err.message);
  } else {
    console.error('Fatal startup error:', err);
  }
  process.exit(1);
});
