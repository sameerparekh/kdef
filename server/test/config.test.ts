import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('reports every problem at once', () => {
    try {
      loadConfig({ PORT: 'abc', SERVE_SPA: 'maybe' });
      expect.fail('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      const problems = (e as ConfigError).problems.join('\n');
      expect(problems).toMatch(/DATABASE_URL/);
      expect(problems).toMatch(/PORT/);
      expect(problems).toMatch(/SERVE_SPA/);
    }
  });

  it('requires WEB_DIST_DIR when SERVE_SPA=true', () => {
    expect(() => loadConfig({ DATABASE_URL: 'postgres://u:p@h/db', SERVE_SPA: 'true' })).toThrow(
      /WEB_DIST_DIR/,
    );
  });

  it('parses a minimal valid env with SPA serving off by default', () => {
    const c = loadConfig({ DATABASE_URL: 'postgres://u:p@h/db' });
    expect(c.port).toBe(8080);
    expect(c.spa).toEqual({ enabled: false });
    expect(c.kdefDir).toBeUndefined();
  });
});
