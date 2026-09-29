import {
  ANGLES,
  AnswerRequest,
  ApiError,
  CreatePlayerRequest,
  EMOTIONS,
  PLAYER_COLORS,
  type Angle,
  type AngleTally,
  type AnswerResponse,
  type ConfusionCell,
  type Emotion,
  type EmotionTally,
  type Leaderboard,
  type LeaderboardEntry,
  type Player,
  type PlayerStats,
  type Question,
  type Round,
} from '@kdef/shared';
import { http, HttpResponse, type RequestHandler } from 'msw';
import type { ZodError } from 'zod';

/**
 * In-memory stand-in for the server, shared by the Vitest suites and the `VITE_MOCK_API=true`
 * dev mode. Every body it returns is built to parse with the schemas in @kdef/shared.
 * It is a fake, not the server: the stats maths here is deliberately naive.
 */

/** The real server owns these numbers; the mock just needs plausible values. */
const MOCK_WINDOW_SIZE = 200;
const MOCK_MIN_ANSWERS = 50;
const DEFAULT_ROUND_LENGTH = 20;

export interface MockOptions {
  roundLength?: number;
  players?: Player[];
  /** Fixed timestamp for `createdAt` / `startedAt`, so output is stable. */
  now?: string;
}

interface MockQuestion {
  id: string;
  roundId: string;
  imageId: string;
  emotion: Emotion;
  angle: Angle;
  position: number;
  chosen: Emotion | null;
}

interface MockRound extends Round {
  questionIds: string[];
}

export interface MockApi {
  handlers: RequestHandler[];
  state: {
    players: Player[];
    rounds: Map<string, MockRound>;
    questions: Map<string, MockQuestion>;
  };
  /** The right answer for a question, for tests that need to answer correctly or wrongly. */
  correctEmotion(questionId: string): Emotion;
  /** Inserts a finished round of `[actual, chosen]` answers (angles cycle), returning its id. */
  seedRound(playerId: string, answers: Array<[Emotion, Emotion]>): string;
}

function pct(correct: number, answered: number): number | null {
  return answered === 0 ? null : correct / answered;
}

function hue(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

/** A placeholder portrait; it shows no emotion, only a colour derived from the image id. */
export function placeholderSvg(imageId: string): string {
  const h = hue(imageId);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 562 762"><rect width="562" height="762" fill="hsl(${h} 40% 85%)"/><ellipse cx="281" cy="381" rx="190" ry="250" fill="hsl(${h} 50% 65%)"/><circle cx="210" cy="330" r="22" fill="#222"/><circle cx="352" cy="330" r="22" fill="#222"/><rect x="221" y="500" width="120" height="14" rx="7" fill="#222"/></svg>`;
}

export function createMockApi(options: MockOptions = {}): MockApi {
  const roundLength = options.roundLength ?? DEFAULT_ROUND_LENGTH;
  const now = options.now ?? '2026-01-01T12:00:00.000Z';
  const players: Player[] = [...(options.players ?? [])];
  const rounds = new Map<string, MockRound>();
  const questions = new Map<string, MockQuestion>();
  let counter = 0;
  const nextId = (): string => {
    counter += 1;
    return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
  };

  const error = (status: number, code: string, message: string) =>
    HttpResponse.json(ApiError.parse({ error: code, message }), { status });
  // Codes and messages below are the server's: server/src/errors.ts (notFound, conflict, parseOr400).
  const notFound = (what: string) => error(404, 'not_found', `${what} not found`);
  /** Same "path: message; ..." text as `parseOr400` in server/src/errors.ts. */
  const badRequest = (err: ZodError) =>
    error(
      400,
      'bad_request',
      err.issues.map((i) => `${i.path.join('.') || '(body)'}: ${i.message}`).join('; '),
    );

  const questionsOf = (round: MockRound) => round.questionIds.map((id) => questions.get(id)!);
  const playerRounds = (playerId: string) =>
    [...rounds.values()].filter((r) => r.playerId === playerId);
  const answeredFor = (playerId: string) =>
    playerRounds(playerId).flatMap((r) => questionsOf(r).filter((q) => q.chosen !== null));

  function tallies(qs: MockQuestion[]): EmotionTally[] {
    return EMOTIONS.map((emotion) => {
      const mine = qs.filter((q) => q.emotion === emotion);
      const correct = mine.filter((q) => q.chosen === emotion).length;
      return { emotion, answered: mine.length, correct, accuracy: pct(correct, mine.length) };
    });
  }

  function publicRound(r: MockRound): Round {
    const { questionIds: _ids, ...round } = r;
    return round;
  }

  const handlers: RequestHandler[] = [
    http.get('/api/players', () => HttpResponse.json({ players })),

    http.post('/api/players', async ({ request }) => {
      const parsed = CreatePlayerRequest.safeParse(await request.json());
      if (!parsed.success) return badRequest(parsed.error);
      const name = parsed.data.displayName;
      if (players.some((p) => p.displayName.toLowerCase() === name.toLowerCase())) {
        return error(409, 'conflict', `A player named "${name}" already exists`);
      }
      const player: Player = {
        id: nextId(),
        displayName: name,
        color: parsed.data.color ?? PLAYER_COLORS[players.length % PLAYER_COLORS.length]!,
        createdAt: now,
      };
      players.push(player);
      return HttpResponse.json(player, { status: 201 });
    }),

    http.delete('/api/players/:id', ({ params }) => {
      const i = players.findIndex((p) => p.id === params.id);
      if (i < 0) return notFound('Player');
      players.splice(i, 1);
      return new HttpResponse(null, { status: 204 });
    }),

    http.post('/api/players/:id/rounds', ({ params }) => {
      const player = players.find((p) => p.id === params.id);
      if (!player) return notFound('Player');
      const roundId = nextId();
      const questionIds: string[] = [];
      // The mock fixes the whole round up front; the real server picks each question at /next.
      for (let i = 0; i < roundLength; i++) {
        const q: MockQuestion = {
          id: nextId(),
          roundId,
          imageId: nextId(),
          emotion: EMOTIONS[(i * 3 + rounds.size) % EMOTIONS.length]!,
          angle: ANGLES[i % 3]!,
          position: i + 1,
          chosen: null,
        };
        questions.set(q.id, q);
        questionIds.push(q.id);
      }
      const round: MockRound = {
        id: roundId,
        playerId: player.id,
        length: roundLength,
        startedAt: now,
        endedAt: null,
        answered: 0,
        correct: 0,
        questionIds,
      };
      rounds.set(roundId, round);
      return HttpResponse.json(publicRound(round), { status: 201 });
    }),

    http.post('/api/rounds/:id/next', ({ params }) => {
      const round = rounds.get(String(params.id));
      if (!round) return notFound('Round');
      const q = questionsOf(round).find((x) => x.chosen === null);
      if (!q) return HttpResponse.json({ status: 'complete' });
      const question: Question = {
        questionId: q.id,
        imageUrl: `/api/images/${q.imageId}`,
        position: q.position,
        total: round.length,
      };
      return HttpResponse.json({ status: 'question', question });
    }),

    http.post('/api/questions/:id/answer', async ({ params, request }) => {
      // Like the server: validate the body (400) before looking up state (404, 409).
      const parsed = AnswerRequest.safeParse(await request.json());
      if (!parsed.success) return badRequest(parsed.error);
      const q = questions.get(String(params.id));
      if (!q) return notFound('Question');
      if (q.chosen !== null)
        return error(409, 'conflict', 'This question has already been answered');
      const round = rounds.get(q.roundId)!;
      q.chosen = parsed.data.emotion;
      const correct = q.chosen === q.emotion;
      round.answered += 1;
      if (correct) round.correct += 1;
      const roundComplete = round.answered >= round.length;
      if (roundComplete) round.endedAt = now;
      const body: AnswerResponse = {
        correct,
        correctEmotion: q.emotion,
        chosenEmotion: q.chosen,
        contrastImageUrl: correct ? null : `/api/images/${nextId()}`,
        roundComplete,
      };
      return HttpResponse.json(body);
    }),

    http.get('/api/rounds/:id', ({ params }) => {
      const round = rounds.get(String(params.id));
      if (!round) return notFound('Round');
      const answered = questionsOf(round).filter((q) => q.chosen !== null);
      return HttpResponse.json({ round: publicRound(round), perEmotion: tallies(answered) });
    }),

    http.get('/api/players/:id/stats', ({ params }) => {
      const player = players.find((p) => p.id === params.id);
      if (!player) return notFound('Player');
      const qs = answeredFor(player.id);
      const perAngle: AngleTally[] = ANGLES.map((angle) => {
        const mine = qs.filter((q) => q.angle === angle);
        const correct = mine.filter((q) => q.chosen === q.emotion).length;
        return { angle, answered: mine.length, correct, accuracy: pct(correct, mine.length) };
      });
      const confusion: ConfusionCell[] = [];
      for (const actual of EMOTIONS) {
        for (const chosen of EMOTIONS) {
          const count = qs.filter((q) => q.emotion === actual && q.chosen === chosen).length;
          if (count > 0) confusion.push({ actual, chosen, count });
        }
      }
      const stats: PlayerStats = {
        player,
        totalAnswered: qs.length,
        totalCorrect: qs.filter((q) => q.chosen === q.emotion).length,
        perEmotion: tallies(qs),
        perAngle,
        confusion,
        recentRounds: playerRounds(player.id)
          .filter((r) => r.endedAt !== null)
          .map(publicRound)
          .reverse(),
      };
      return HttpResponse.json(stats);
    }),

    http.get('/api/leaderboard', () => {
      const scored = players.map((player) => {
        const all = answeredFor(player.id);
        const window = all.slice(-MOCK_WINDOW_SIZE);
        const correct = window.filter((q) => q.chosen === q.emotion).length;
        const byAcc = tallies(window)
          .filter((t) => t.accuracy !== null)
          .sort((a, b) => b.accuracy! - a.accuracy!);
        return { player, window, correct, byAcc, total: all.length };
      });
      const ranked = scored
        .filter((s) => s.window.length >= MOCK_MIN_ANSWERS)
        .sort((a, b) => b.correct / b.window.length - a.correct / a.window.length);
      const entries: LeaderboardEntry[] = [
        ...ranked,
        ...scored.filter((s) => s.window.length < MOCK_MIN_ANSWERS),
      ].map((s) => ({
        player: s.player,
        rank: s.window.length >= MOCK_MIN_ANSWERS ? ranked.indexOf(s) + 1 : null,
        windowAnswered: s.window.length,
        windowCorrect: s.correct,
        accuracy: pct(s.correct, s.window.length),
        totalAnswered: s.total,
        bestEmotion: s.byAcc[0]?.emotion ?? null,
        worstEmotion: s.byAcc[s.byAcc.length - 1]?.emotion ?? null,
      }));
      const body: Leaderboard = {
        windowSize: MOCK_WINDOW_SIZE,
        minAnswers: MOCK_MIN_ANSWERS,
        entries,
      };
      return HttpResponse.json(body);
    }),

    http.get('/api/images/:id', ({ params }) =>
      HttpResponse.text(placeholderSvg(String(params.id)), {
        headers: { 'content-type': 'image/svg+xml' },
      }),
    ),
  ];

  function seedRound(playerId: string, answers: Array<[Emotion, Emotion]>): string {
    const roundId = nextId();
    const questionIds = answers.map(([emotion, chosen], i) => {
      const q: MockQuestion = {
        id: nextId(),
        roundId,
        imageId: nextId(),
        emotion,
        angle: ANGLES[i % ANGLES.length]!,
        position: i + 1,
        chosen,
      };
      questions.set(q.id, q);
      return q.id;
    });
    rounds.set(roundId, {
      id: roundId,
      playerId,
      length: answers.length,
      startedAt: now,
      endedAt: now,
      answered: answers.length,
      correct: answers.filter(([a, c]) => a === c).length,
      questionIds,
    });
    return roundId;
  }

  return {
    handlers,
    state: { players, rounds, questions },
    correctEmotion: (questionId) => questions.get(questionId)!.emotion,
    seedRound,
  };
}
