import { z } from 'zod';
import { DEFAULT_MANIFEST_PATH } from './seed/manifest.js';

/**
 * Environment config, validated once at boot. Missing or invalid required keys crash
 * startup with every problem listed at once (docs/process/no-dark-by-default.md).
 */
const EnvSchema = z.object({
  DATABASE_URL: z.string().url({ message: 'must be a postgres:// URL' }),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  HOST: z.string().default('0.0.0.0'),
  /** Directory holding the KDEF emotion folders. Needed only while the images table is empty. */
  KDEF_DIR: z.string().min(1).optional(),
  /** Camera-angle manifest, i.e. the expected image inventory. Defaults to the committed seed/angles.csv. */
  SEED_MANIFEST: z.string().min(1).optional(),
  /** Explicit switch: serve the built SPA from WEB_DIST_DIR. Logged at startup. */
  SERVE_SPA: z.enum(['true', 'false']).default('false'),
  WEB_DIST_DIR: z.string().min(1).optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export interface Config {
  databaseUrl: string;
  port: number;
  host: string;
  kdefDir: string | undefined;
  seedManifestPath: string;
  spa: { enabled: false } | { enabled: true; distDir: string };
  logLevel: z.infer<typeof EnvSchema>['LOG_LEVEL'];
}

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid configuration:\n  - ${problems.join('\n  - ')}`);
    this.name = 'ConfigError';
  }
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const parsed = EnvSchema.safeParse(env);
  const problems: string[] = parsed.success
    ? []
    : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);

  if (parsed.success && parsed.data.SERVE_SPA === 'true' && !parsed.data.WEB_DIST_DIR) {
    problems.push('WEB_DIST_DIR: required when SERVE_SPA=true');
  }
  if (!parsed.success || problems.length > 0) throw new ConfigError(problems);

  const e = parsed.data;
  return {
    databaseUrl: e.DATABASE_URL,
    port: e.PORT,
    host: e.HOST,
    kdefDir: e.KDEF_DIR,
    seedManifestPath: e.SEED_MANIFEST ?? DEFAULT_MANIFEST_PATH,
    spa: e.SERVE_SPA === 'true' ? { enabled: true, distDir: e.WEB_DIST_DIR! } : { enabled: false },
    logLevel: e.LOG_LEVEL,
  };
}
