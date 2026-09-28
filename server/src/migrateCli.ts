import { loadConfig } from './config.js';
import { migrate } from './db/migrate.js';

const config = loadConfig(process.env);
const { applied } = await migrate(config.databaseUrl);
console.log(
  applied.length ? `Applied migrations: ${applied.join(', ')}` : 'No pending migrations.',
);
