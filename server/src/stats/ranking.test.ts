import { describe, expect, it } from 'vitest';
import { LEADERBOARD_EMOTION_MIN_ANSWERS, LEADERBOARD_MIN_ANSWERS } from './config.js';
import { accuracyOf, averagePointsOf, bestAndWorst, rankPlayers } from './ranking.js';

const player = (name: string, windowAnswered: number, windowCorrect: number, created = 0) => ({
  name,
  windowAnswered,
  windowCorrect,
  // Every hit is worth 100 unless the test says otherwise, so the accuracy-shaped cases
  // below rank the same way under average points.
  windowPoints: windowCorrect * 100,
  createdAt: new Date(2026, 0, 1, 0, 0, created).toISOString(),
});

describe('accuracyOf', () => {
  it('is null with no answers, else correct / answered', () => {
    expect(accuracyOf(0, 0)).toBeNull();
    expect(accuracyOf(4, 3)).toBe(0.75);
  });
});

describe('averagePointsOf', () => {
  it('is null with no answers, else points / answered (misses count as 0)', () => {
    expect(averagePointsOf(0, 0)).toBeNull();
    expect(averagePointsOf(4, 150)).toBe(37.5);
  });
});

describe('bestAndWorst', () => {
  const n = LEADERBOARD_EMOTION_MIN_ANSWERS;

  it('ignores emotions below the minimum number of answers', () => {
    const r = bestAndWorst([
      { emotion: 'happy', answered: n - 1, correct: n - 1 },
      { emotion: 'sad', answered: n, correct: 1 },
    ]);
    expect(r).toEqual({ best: 'sad', worst: 'sad' });
  });

  it('is null/null when nothing qualifies', () => {
    expect(bestAndWorst([{ emotion: 'happy', answered: n - 1, correct: 0 }])).toEqual({
      best: null,
      worst: null,
    });
    expect(bestAndWorst([])).toEqual({ best: null, worst: null });
  });

  it('breaks accuracy ties in EMOTIONS order', () => {
    const r = bestAndWorst([
      { emotion: 'surprise', answered: n, correct: n },
      { emotion: 'angry', answered: n, correct: n },
      { emotion: 'sad', answered: n, correct: 0 },
      { emotion: 'fear', answered: n, correct: 0 },
    ]);
    expect(r).toEqual({ best: 'angry', worst: 'fear' });
  });
});

describe('rankPlayers', () => {
  const full = LEADERBOARD_MIN_ANSWERS;

  it('ranks by accuracy, then more answers, sharing ranks on exact ties (1, 2, 2, 4)', () => {
    const out = rankPlayers([
      player('c', full, full - 10, 3),
      player('b2', full, full, 2),
      player('a', 100, 100, 1),
      player('b1', full, full, 0),
    ]);
    expect(out.map((o) => [o.item.name, o.rank])).toEqual([
      ['a', 1],
      ['b1', 2],
      ['b2', 2],
      ['c', 4],
    ]);
  });

  it('puts players below the minimum last, unranked, most answers first', () => {
    const out = rankPlayers([
      player('few', full - 1, full - 1),
      player('none', 0, 0),
      player('ranked', full, 0),
      player('some', 5, 5),
    ]);
    expect(out.map((o) => [o.item.name, o.rank])).toEqual([
      ['ranked', 1],
      ['few', null],
      ['some', null],
      ['none', null],
    ]);
  });

  it('ranks by average points per answer, not accuracy', () => {
    const at = (name: string, answered: number, points: number, created = 0) => ({
      ...player(name, answered, answered, created),
      windowPoints: points,
    });
    const out = rankPlayers([
      at('slowPerfect', full, full * 25, 0),
      at('fastSloppy', full, full * 50, 1),
      at('fastPerfect', full, full * 100, 2),
    ]);
    expect(out.map((o) => [o.item.name, o.rank])).toEqual([
      ['fastPerfect', 1],
      ['fastSloppy', 2],
      ['slowPerfect', 3],
    ]);
  });

  it('breaks equal averages by more window answers, and shares a rank only on equal answers', () => {
    const at = (name: string, answered: number, points: number, created = 0) => ({
      ...player(name, answered, answered, created),
      windowPoints: points,
    });
    // All average exactly 50.
    const out = rankPlayers([
      at('few', full, full * 50, 0),
      at('twinA', 2 * full, 2 * full * 50, 1),
      at('twinB', 2 * full, 2 * full * 50, 2),
    ]);
    expect(out.map((o) => [o.item.name, o.rank])).toEqual([
      ['twinA', 1],
      ['twinB', 1],
      ['few', 3],
    ]);
  });
});
