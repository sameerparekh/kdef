import { describe, expect, it } from 'vitest';
import { liveRng, seededRng } from '../src/rng.js';

describe('liveRng', () => {
  it('returns floats in [0, 1) without throwing', () => {
    for (let i = 0; i < 1000; i++) {
      const x = liveRng.next();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});

describe('seededRng', () => {
  it('is deterministic for a seed', () => {
    const a = seededRng(7);
    const b = seededRng(7);
    expect([a.next(), a.next()]).toEqual([b.next(), b.next()]);
  });
});
