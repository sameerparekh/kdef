import { liveClock } from './clock.js';
import { loadConfig } from './config.js';
import { connect } from './db/connect.js';
import { migrate } from './db/migrate.js';
import { DEFAULT_MANIFEST_PATH, reseedImages } from './seed/index.js';

const config = loadConfig(process.env);
await migrate(config.databaseUrl);
const db = connect(config.databaseUrl);
try {
  await reseedImages({
    db,
    clock: liveClock,
    kdefDir: config.kdefDir,
    manifestPath: DEFAULT_MANIFEST_PATH,
    log: (line) => console.log(line),
  });
} finally {
  await db.destroy();
}
