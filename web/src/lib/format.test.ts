import { describe, expect, it } from 'vitest';
import { formatAvgPoints, formatPoints, formatPointsEarned, formatSeconds } from './format';

describe('formatSeconds', () => {
  it('shows seconds with one decimal', () => {
    expect(formatSeconds(0)).toBe('0.0 s');
    expect(formatSeconds(2340)).toBe('2.3 s');
    expect(formatSeconds(2360)).toBe('2.4 s');
    expect(formatSeconds(61_000)).toBe('61.0 s');
  });
});

describe('formatPoints', () => {
  it('pluralises: 1 point, otherwise points', () => {
    expect(formatPoints(1)).toBe('1 point');
    expect(formatPoints(0)).toBe('0 points');
    expect(formatPoints(2)).toBe('2 points');
    expect(formatPoints(150)).toBe('150 points');
  });
});

describe('formatPointsEarned', () => {
  it('shows a plus sign and pluralises', () => {
    expect(formatPointsEarned(87)).toBe('+87 points');
    expect(formatPointsEarned(1)).toBe('+1 point');
    expect(formatPointsEarned(0)).toBe('+0 points');
  });
});

describe('formatAvgPoints', () => {
  it('shows one decimal, and a dash (never 0) when there is nothing to average', () => {
    expect(formatAvgPoints(37.5)).toBe('37.5');
    expect(formatAvgPoints(100)).toBe('100.0');
    expect(formatAvgPoints(0)).toBe('0.0');
    expect(formatAvgPoints(null)).toBe('—');
  });
});
