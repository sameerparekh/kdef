import { describe, expect, it } from 'vitest';
import { ConfigError, describeBind, loadConfig } from '../src/config.js';
import { DEFAULT_MANIFEST_PATH } from '../src/seed/manifest.js';

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

  it('defaults the seed manifest to the committed one and lets SEED_MANIFEST override it', () => {
    expect(loadConfig({ DATABASE_URL: 'postgres://u:p@h/db' }).seedManifestPath).toBe(
      DEFAULT_MANIFEST_PATH,
    );
    expect(
      loadConfig({ DATABASE_URL: 'postgres://u:p@h/db', SEED_MANIFEST: '/fixtures/angles.csv' })
        .seedManifestPath,
    ).toBe('/fixtures/angles.csv');
  });

  it('binds all interfaces by default and lets HOST narrow it', () => {
    expect(loadConfig({ DATABASE_URL: 'postgres://u:p@h/db' }).host).toBe('0.0.0.0');
    expect(loadConfig({ DATABASE_URL: 'postgres://u:p@h/db', HOST: '127.0.0.1' }).host).toBe(
      '127.0.0.1',
    );
  });

  it('rejects an empty HOST', () => {
    expect(() => loadConfig({ DATABASE_URL: 'postgres://u:p@h/db', HOST: '' })).toThrow(/HOST/);
  });
});

describe('describeBind', () => {
  it('says all interfaces for a wildcard address', () => {
    expect(describeBind('0.0.0.0', 8080)).toBe('listening on 0.0.0.0:8080 (all interfaces)');
    expect(describeBind('::', 8080)).toBe('listening on [::]:8080 (all interfaces)');
  });

  it('says this machine only for a loopback address', () => {
    expect(describeBind('127.0.0.1', 9000)).toBe('listening on 127.0.0.1:9000 (this machine only)');
    expect(describeBind('localhost', 9000)).toBe('listening on localhost:9000 (this machine only)');
  });

  it('names the address for anything else', () => {
    expect(describeBind('192.168.1.5', 8080)).toBe(
      'listening on 192.168.1.5:8080 (that interface)',
    );
  });
});
