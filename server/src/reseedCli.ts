import { liveClock } from './clock.js';
import { loadConfig } from './config.js';
import { connect } from './db/connect.js';
import { migrate } from './db/migrate.js';
import { reseedImages } from './seed/index.js';

const config = loadConfig(process.env);
await migrate(config.databaseUrl);
const db = connect(config.databaseUrl);
try {
  await reseedImages({
    db,
    clock: liveClock,
    kdefDir: config.kdefDir,
    manifestPath: config.seedManifestPath,
    log: (line) => console.log(line),
  });
} finally {
  await db.destroy();
}
