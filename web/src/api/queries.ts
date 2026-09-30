import {
  AnswerResponse,
  CreatePlayerRequest,
  Leaderboard,
  NextResponse,
  NoContent,
  Player,
  PlayerList,
  PlayerStats,
  Round,
  RoundSummary,
  type Emotion,
} from '@kdef/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from './client';

/** All React Query keys live here so invalidation stays consistent. */
export const qk = {
  players: ['players'] as const,
  /** Prefix for every player's stats, so one call invalidates them all. */
  allStats: ['stats'] as const,
  stats: (playerId: string) => ['stats', playerId] as const,
  leaderboard: ['leaderboard'] as const,
  round: (roundId: string) => ['rounds', roundId] as const,
  next: (roundId: string) => ['rounds', roundId, 'next'] as const,
};

export function usePlayers() {
  return useQuery({
    queryKey: qk.players,
    queryFn: () => request(PlayerList, '/api/players'),
  });
}

export function useCreatePlayer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePlayerRequest) =>
      request(Player, '/api/players', { method: 'POST', body }),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: qk.players }),
        qc.invalidateQueries({ queryKey: qk.leaderboard }),
      ]),
  });
}

export function useDeletePlayer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (playerId: string) =>
      request(NoContent, `/api/players/${playerId}`, { method: 'DELETE' }),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: qk.players }),
        qc.invalidateQueries({ queryKey: qk.leaderboard }),
        qc.invalidateQueries({ queryKey: qk.allStats }),
      ]),
  });
}

export function useStartRound() {
  return useMutation({
    mutationFn: (playerId: string) =>
      request(Round, `/api/players/${playerId}/rounds`, { method: 'POST' }),
  });
}

/**
 * The current question of a round. `/next` returns the unanswered question if there is one,
 * so a fresh mount (a reload) resumes. It is kept as a query so React Query de-duplicates the
 * StrictMode double mount; callers `resetQueries` to move on to the following question.
 */
export function useCurrentQuestion(roundId: string) {
  return useQuery({
    queryKey: qk.next(roundId),
    queryFn: () => request(NextResponse, `/api/rounds/${roundId}/next`, { method: 'POST' }),
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
}

export function useSubmitAnswer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      questionId: string;
      roundId: string;
      emotion: Emotion;
      /** Milliseconds since the photo loaded; omitted when it never did. */
      clientElapsedMs?: number;
    }) =>
      request(AnswerResponse, `/api/questions/${vars.questionId}/answer`, {
        method: 'POST',
        body:
          vars.clientElapsedMs === undefined
            ? { emotion: vars.emotion }
            : { emotion: vars.emotion, clientElapsedMs: vars.clientElapsedMs },
      }),
    onSuccess: (_result, vars) =>
      Promise.all([
        // The quiz page shows the round total from the server's summary, so refresh it (exact:
        // the /next query shares this key prefix and must not refetch).
        qc.invalidateQueries({ queryKey: qk.round(vars.roundId), exact: true }),
        qc.invalidateQueries({ queryKey: qk.allStats }),
        qc.invalidateQueries({ queryKey: qk.leaderboard }),
      ]),
  });
}

export function useRoundSummary(roundId: string) {
  return useQuery({
    queryKey: qk.round(roundId),
    queryFn: () => request(RoundSummary, `/api/rounds/${roundId}`),
  });
}

export function usePlayerStats(playerId: string) {
  return useQuery({
    queryKey: qk.stats(playerId),
    queryFn: () => request(PlayerStats, `/api/players/${playerId}/stats`),
  });
}

export function useLeaderboard() {
  return useQuery({
    queryKey: qk.leaderboard,
    queryFn: () => request(Leaderboard, '/api/leaderboard'),
  });
}
