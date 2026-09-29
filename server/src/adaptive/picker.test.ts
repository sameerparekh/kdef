import { describe, expect, it } from 'vitest';
import { ANGLES, EMOTIONS, type Angle, type Emotion } from '@kdef/shared';
import { seededRng } from '../rng.js';
import {
  ALPHA,
  ANGLED_MASTERY_OFFSET,
  ANGLED_MAX,
  ANGLED_MIN,
  BETA,
  EMOTION_HISTORY_WINDOW,
  EMOTION_WEIGHT_FLOOR,
  RECENT_IMAGE_EXCLUSION,
  RECENT_SUBJECT_AVOIDANCE,
} from './config.js';
import {
  angledProbability,
  emotionWeights,
  isAngled,
  pickEmotionAndTier,
  pickImage,
  type AnswerRecord,
  type Candidate,
} from './picker.js';

const rec = (emotion: Emotion, angle: Angle, correct: boolean): AnswerRecord => ({
  emotion,
  angle,
  correct,
});
const many = (n: number, r: AnswerRecord): AnswerRecord[] => Array.from({ length: n }, () => r);

describe('emotionWeights', () => {
  it('is uniform for a player with no history', () => {
    const w = emotionWeights([]);
    const values = EMOTIONS.map((e) => w[e]);
    expect(new Set(values).size).toBe(1);
    expect(values[0]).toBeCloseTo(EMOTION_WEIGHT_FLOOR + ALPHA / (ALPHA + BETA), 10);
  });

  it('is floor + smoothed error rate over the answers for that emotion', () => {
    const history = [...many(3, rec('fear', 'frontal', false)), rec('fear', 'frontal', true)];
    expect(emotionWeights(history).fear).toBeCloseTo(
      EMOTION_WEIGHT_FLOOR + (3 + ALPHA) / (4 + ALPHA + BETA),
      10,
    );
  });

  it('only looks at the most recent window of answers (history is newest first)', () => {
    const recentRight = many(EMOTION_HISTORY_WINDOW, rec('sad', 'frontal', true));
    const oldWrong = many(100, rec('sad', 'frontal', false));
    const w = emotionWeights([...recentRight, ...oldWrong]);
    expect(w.sad).toBeCloseTo(
      EMOTION_WEIGHT_FLOOR + ALPHA / (EMOTION_HISTORY_WINDOW + ALPHA + BETA),
      10,
    );
  });

  it('keeps a weight above zero even for a perfect emotion', () => {
    const w = emotionWeights(many(100, rec('happy', 'frontal', true)));
    expect(w.happy).toBeGreaterThan(EMOTION_WEIGHT_FLOOR);
  });
});

describe('angledProbability', () => {
  const frontalHistory = (right: number, total: number) => [
    ...many(right, rec('fear', 'frontal', true)),
    ...many(total - right, rec('fear', 'unknown', false)),
  ];

  it('sits at the floor for a new player', () => {
    expect(angledProbability([], 'fear')).toBe(ANGLED_MIN);
  });

  it('rises with frontal mastery and follows clamp(accuracy - offset, min, max)', () => {
    const p = [10, 20, 26, 30].map((right) => angledProbability(frontalHistory(right, 30), 'fear'));
    for (let i = 1; i < p.length; i++) expect(p[i]).toBeGreaterThanOrEqual(p[i - 1]!);
    expect(p[0]).toBe(ANGLED_MIN);
    expect(p[2]).toBeGreaterThan(p[1]!);
    const acc = (26 + BETA) / (30 + ALPHA + BETA);
    expect(p[2]).toBeCloseTo(
      Math.min(ANGLED_MAX, Math.max(ANGLED_MIN, acc - ANGLED_MASTERY_OFFSET)),
      10,
    );
  });

  it('never exceeds ANGLED_MAX (a perfect window gives smoothed accuracy minus the offset)', () => {
    const W = EMOTION_HISTORY_WINDOW;
    const p = angledProbability(many(W, rec('fear', 'frontal', true)), 'fear');
    const accuracy = (W + BETA) / (W + ALPHA + BETA);
    expect(p).toBeCloseTo(Math.min(ANGLED_MAX, accuracy - ANGLED_MASTERY_OFFSET), 10);
    expect(p).toBeLessThanOrEqual(ANGLED_MAX);
  });

  it('ignores other emotions', () => {
    expect(angledProbability(many(30, rec('happy', 'frontal', true)), 'fear')).toBe(ANGLED_MIN);
  });

  it('drops back to the floor when angled accuracy is well below frontal accuracy', () => {
    const strongFrontal = many(20, rec('fear', 'frontal', true));
    const weakAngled = many(10, rec('fear', 'half_left', false));
    expect(angledProbability([...weakAngled, ...strongFrontal], 'fear')).toBe(ANGLED_MIN);
    const okAngled = many(10, rec('fear', 'half_left', true));
    expect(angledProbability([...okAngled, ...strongFrontal], 'fear')).toBeGreaterThan(ANGLED_MIN);
  });
});

describe('pickEmotionAndTier', () => {
  it('draws roughly uniformly over emotions for a new player', () => {
    const rng = seededRng(1);
    const n = 14000;
    const counts = new Map<Emotion, number>();
    for (let i = 0; i < n; i++) {
      const { emotion } = pickEmotionAndTier([], rng);
      counts.set(emotion, (counts.get(emotion) ?? 0) + 1);
    }
    for (const e of EMOTIONS) {
      expect(Math.abs((counts.get(e) ?? 0) / n - 1 / EMOTIONS.length)).toBeLessThan(0.02);
    }
  });

  it('only picks from the available emotions', () => {
    const rng = seededRng(2);
    const available = ['happy', 'sad'] as const;
    const seen = new Set<Emotion>();
    for (let i = 0; i < 500; i++) seen.add(pickEmotionAndTier([], rng, available).emotion);
    expect([...seen].sort()).toEqual(['happy', 'sad']);
  });

  it('draws angled photos with probability angledProbability', () => {
    const history = many(30, rec('fear', 'frontal', true));
    const p = angledProbability(history, 'fear');
    const rng = seededRng(7);
    let fear = 0;
    let angled = 0;
    for (let i = 0; i < 20000; i++) {
      const pick = pickEmotionAndTier(history, rng);
      if (pick.emotion === 'fear') {
        fear++;
        if (pick.tier === 'angled') angled++;
      }
    }
    expect(Math.abs(angled / fear - p)).toBeLessThan(0.03);
  });
});

describe('simulated players', () => {
  interface Img extends Candidate {
    emotion: Emotion;
  }
  function buildPool(subjects: number): Img[] {
    const out: Img[] = [];
    for (const emotion of EMOTIONS)
      for (let subjectKey = 1; subjectKey <= subjects; subjectKey++)
        for (const angle of ['frontal', 'half_left', 'half_right'] as const)
          out.push({
            id: `${emotion}-${subjectKey}-${angle}`,
            emotion,
            angle,
            subjectKey,
            timesSeen: 0,
          });
    return out;
  }
  const smallPool = buildPool(5);
  // Big enough that the last-50 exclusion never empties the frontal tier.
  const bigPool = buildPool(20);

  function simulate(opts: {
    pool?: Img[];
    steps: number;
    seed: number;
    isCorrect: (img: Img) => boolean;
  }): Img[] {
    const pool = opts.pool ?? smallPool;
    const rng = seededRng(opts.seed);
    const seen = new Map<string, number>();
    const shown: Img[] = []; // newest first
    const history: AnswerRecord[] = []; // newest first
    for (let i = 0; i < opts.steps; i++) {
      const { emotion, tier } = pickEmotionAndTier(history, rng);
      const candidates = pool
        .filter((p) => p.emotion === emotion)
        .map((p) => ({ ...p, timesSeen: seen.get(p.id) ?? 0 }));
      const pick = pickImage({
        candidates,
        tier,
        recentImageIds: shown.slice(0, RECENT_IMAGE_EXCLUSION).map((s) => s.id),
        recentSubjectKeys: shown.slice(0, RECENT_SUBJECT_AVOIDANCE).map((s) => s.subjectKey),
        rng,
      });
      if (!pick) throw new Error('no pick');
      const img = pool.find((p) => p.id === pick.id)!;
      seen.set(img.id, (seen.get(img.id) ?? 0) + 1);
      shown.unshift(img);
      history.unshift({ emotion, angle: img.angle, correct: opts.isCorrect(img) });
    }
    return shown;
  }

  it('shows an always-missed emotion far more often than the others, as the formula predicts', () => {
    const shown = simulate({ steps: 3000, seed: 11, isCorrect: (img) => img.emotion !== 'fear' });
    const tail = shown.slice(0, 1500);
    const share = tail.filter((s) => s.emotion === 'fear').length / tail.length;
    // Steady state with full windows: fear error = (W+a)/(W+a+b), others = a/(W+a+b).
    const W = EMOTION_HISTORY_WINDOW;
    const fearW = EMOTION_WEIGHT_FLOOR + (W + ALPHA) / (W + ALPHA + BETA);
    const otherW = EMOTION_WEIGHT_FLOOR + ALPHA / (W + ALPHA + BETA);
    const expected = fearW / (fearW + (EMOTIONS.length - 1) * otherW);
    expect(share).toBeGreaterThan(1 / EMOTIONS.length + 0.3);
    expect(Math.abs(share - expected)).toBeLessThan(0.05);
  });

  it('does not show an always-missed photo more often than an always-solved one (within its emotion)', () => {
    const target = smallPool.find(
      (p) => p.emotion === 'sad' && p.subjectKey === 2 && p.angle === 'frontal',
    )!;
    const targetShareOfSad = (missTarget: boolean) => {
      const shown = simulate({
        steps: 6000,
        seed: 5,
        isCorrect: (img) => !(missTarget && img.id === target.id),
      });
      const sad = shown.filter((s) => s.emotion === 'sad');
      return sad.filter((s) => s.id === target.id).length / sad.length;
    };
    const missed = targetShareOfSad(true);
    const solved = targetShareOfSad(false);
    expect(solved).toBeGreaterThan(0.03); // sanity: the photo does get shown
    expect(missed).toBeLessThanOrEqual(solved + 0.015);
    expect(missed).toBeLessThan(2 / 15);
  });

  it('shows more angled photos to a player who masters frontal ones', () => {
    const angledShare = (isCorrect: (i: Img) => boolean) => {
      const tail = simulate({ pool: bigPool, steps: 3000, seed: 3, isCorrect }).slice(0, 1500);
      return tail.filter((s) => isAngled(s.angle)).length / tail.length;
    };
    const novice = angledShare((i) => i.angle !== 'frontal' || i.subjectKey % 2 === 0);
    const master = angledShare(() => true);
    expect(master).toBeGreaterThan(novice + 0.2);
    expect(master).toBeLessThanOrEqual(ANGLED_MAX + 0.05);
  });
});

describe('pickImage', () => {
  const cand = (
    id: string,
    subjectKey: number,
    angle: Angle = 'frontal',
    timesSeen = 0,
  ): Candidate => ({ id, angle, subjectKey, timesSeen });
  const base = { recentImageIds: [], recentSubjectKeys: [] };

  it('returns null when there are no candidates', () => {
    expect(pickImage({ ...base, candidates: [], tier: 'plain', rng: seededRng(1) })).toBeNull();
  });

  it('excludes the last-shown images', () => {
    const candidates = [cand('a', 1), cand('b', 2), cand('c', 3)];
    for (let seed = 0; seed < 50; seed++) {
      const pick = pickImage({
        candidates,
        tier: 'plain',
        recentImageIds: ['a', 'c'],
        recentSubjectKeys: [],
        rng: seededRng(seed),
      });
      expect(pick?.id).toBe('b');
    }
  });

  it('relaxes the exclusion instead of failing when it would empty the set', () => {
    const pick = pickImage({
      candidates: [cand('a', 1), cand('b', 2)],
      tier: 'plain',
      recentImageIds: ['a', 'b'],
      recentSubjectKeys: [],
      rng: seededRng(1),
    });
    expect(['a', 'b']).toContain(pick?.id);
  });

  it('prefers least-seen images', () => {
    const candidates = [
      cand('a', 1, 'frontal', 3),
      cand('b', 2, 'frontal', 1),
      cand('c', 3, 'frontal', 1),
    ];
    for (let seed = 0; seed < 50; seed++) {
      const pick = pickImage({ ...base, candidates, tier: 'plain', rng: seededRng(seed) });
      expect(['b', 'c']).toContain(pick?.id);
    }
  });

  it('among ties prefers a subject not shown recently', () => {
    const candidates = [cand('a', 1), cand('b', 2), cand('c', 3)];
    for (let seed = 0; seed < 50; seed++) {
      const pick = pickImage({
        candidates,
        tier: 'plain',
        recentImageIds: [],
        recentSubjectKeys: [1, 2],
        rng: seededRng(seed),
      });
      expect(pick?.id).toBe('c');
    }
  });

  it('least-seen beats subject avoidance', () => {
    const candidates = [cand('a', 1, 'frontal', 0), cand('b', 2, 'frontal', 2)];
    const pick = pickImage({
      candidates,
      tier: 'plain',
      recentImageIds: [],
      recentSubjectKeys: [1],
      rng: seededRng(1),
    });
    expect(pick?.id).toBe('a');
  });

  it('breaks remaining ties uniformly', () => {
    const candidates = [cand('a', 1), cand('b', 2), cand('c', 3), cand('d', 4)];
    const rng = seededRng(9);
    const counts = new Map<string, number>();
    for (let i = 0; i < 8000; i++) {
      const id = pickImage({ ...base, candidates, tier: 'plain', rng })!.id;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    for (const id of ['a', 'b', 'c', 'd']) {
      expect(Math.abs((counts.get(id) ?? 0) / 8000 - 0.25)).toBeLessThan(0.03);
    }
  });

  it('respects the requested tier', () => {
    const candidates = [
      cand('f', 1, 'frontal'),
      cand('l', 2, 'half_left'),
      cand('u', 3, 'unknown'),
    ];
    for (let seed = 0; seed < 30; seed++) {
      const angled = pickImage({ ...base, candidates, tier: 'angled', rng: seededRng(seed) });
      const plain = pickImage({ ...base, candidates, tier: 'plain', rng: seededRng(seed) });
      expect(angled?.id).toBe('l');
      expect(['f', 'u']).toContain(plain?.id);
    }
  });

  it('falls back to the other tier when the chosen tier is empty', () => {
    const onlyPlain = [cand('f', 1, 'frontal'), cand('g', 2, 'unknown')];
    const a = pickImage({ ...base, candidates: onlyPlain, tier: 'angled', rng: seededRng(1) });
    expect(['f', 'g']).toContain(a?.id);
    const onlyAngled = [cand('l', 1, 'half_left'), cand('r', 2, 'half_right')];
    const b = pickImage({ ...base, candidates: onlyAngled, tier: 'plain', rng: seededRng(1) });
    expect(['l', 'r']).toContain(b?.id);
  });

  it('classifies angles', () => {
    expect(ANGLES.filter(isAngled)).toEqual(['half_left', 'half_right']);
  });
});
