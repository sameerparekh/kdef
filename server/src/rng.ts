import { randomBytes } from 'node:crypto';

/**
 * The only source of randomness in the server. Inject it; never call Math.random()
 * (enforced by eslint.config.js). Tests use seededRng for deterministic sequences.
 */
export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
}

const RANDOM_BYTES = 6;
const TWO_POW_48 = 2 ** (8 * RANDOM_BYTES);

export const liveRng: Rng = {
  // 48 random bits scaled into [0, 1). (crypto.randomInt caps its range below 2^48.)
  next: () => randomBytes(RANDOM_BYTES).readUIntBE(0, RANDOM_BYTES) / TWO_POW_48,
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
