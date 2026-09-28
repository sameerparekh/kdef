import { randomInt } from 'node:crypto';

/**
 * The only source of randomness in the server. Inject it; never call Math.random()
 * (enforced by eslint.config.js). Tests use seededRng for deterministic sequences.
 */
export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
}

const TWO_POW_48 = 2 ** 48;

export const liveRng: Rng = {
  next: () => randomInt(0, TWO_POW_48) / TWO_POW_48,
};

/** mulberry32: small, fast, deterministic PRNG for tests and simulations. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return {
    next() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}
