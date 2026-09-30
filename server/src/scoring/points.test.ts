import { describe, expect, it } from 'vitest';
import { GRACE_MS, HALF_LIFE_MS, MAX_POINTS, MIN_POINTS } from './config.js';
import { effectiveElapsedMs, pointsFor } from './points.js';

describe('scoring constants', () => {
  it('start at the values the issue specifies', () => {
    expect([MAX_POINTS, GRACE_MS, HALF_LIFE_MS, MIN_POINTS]).toEqual([100, 1000, 4000, 1]);
  });
});

describe('pointsFor', () => {
  it('gives full points at 0 s and throughout the grace period', () => {
    expect(pointsFor(true, 0)).toBe(100);
    expect(pointsFor(true, 999)).toBe(100);
    expect(pointsFor(true, 1000)).toBe(100);
  });

  it('starts decaying just after the grace period', () => {
    // 100 * 2^(-1/4000) = 99.98, still rounds to 100.
    expect(pointsFor(true, 1001)).toBe(100);
    // 100 * 2^(-1000/4000) = 84.09
    expect(pointsFor(true, 2000)).toBe(84);
  });

  it('halves every half-life after the grace period', () => {
    expect(pointsFor(true, 1000 + 4000)).toBe(50);
    expect(pointsFor(true, 1000 + 8000)).toBe(25);
    // 12.5 rounds half up.
    expect(pointsFor(true, 1000 + 12000)).toBe(13);
  });

  it('never drops below MIN_POINTS for a correct answer, however slow', () => {
    // 100 * 2^-5 = 3.125, 100 * 2^-6 = 1.5625, 100 * 2^-7 = 0.78
    expect(pointsFor(true, 1000 + 20000)).toBe(3);
    expect(pointsFor(true, 1000 + 24000)).toBe(2);
    expect(pointsFor(true, 1000 + 28000)).toBe(1);
    expect(pointsFor(true, 10 * 60 * 1000)).toBe(1);
    expect(pointsFor(true, Number.MAX_SAFE_INTEGER)).toBe(1);
  });

  it('is monotonically non-increasing in time', () => {
    let prev = Infinity;
    for (let t = 0; t <= 60_000; t += 250) {
      const p = pointsFor(true, t);
      expect(p).toBeLessThanOrEqual(prev);
      expect(p).toBeGreaterThanOrEqual(MIN_POINTS);
      prev = p;
    }
  });

  it('scores a miss 0 at any time', () => {
    expect(pointsFor(false, 0)).toBe(0);
    expect(pointsFor(false, 3000)).toBe(0);
    expect(pointsFor(false, 10 * 60 * 1000)).toBe(0);
  });
});

describe('effectiveElapsedMs', () => {
  it('uses the client value when it is smaller than the server value', () => {
    expect(effectiveElapsedMs(3000, 500)).toBe(500);
    expect(effectiveElapsedMs(3000, 0)).toBe(0);
  });

  it('never lets the client claim more time than the server measured', () => {
    expect(effectiveElapsedMs(3000, 10_000)).toBe(3000);
    expect(effectiveElapsedMs(3000, 3000)).toBe(3000);
  });

  it('falls back to the server value when the client value is absent or negative', () => {
    expect(effectiveElapsedMs(3000, undefined)).toBe(3000);
    expect(effectiveElapsedMs(3000, -1)).toBe(3000);
  });

  it('rounds to whole milliseconds', () => {
    expect(effectiveElapsedMs(3000, 499.6)).toBe(500);
  });
});
