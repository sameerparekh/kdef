import type { Emotion } from '@kdef/shared';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../test/server';
import { describe, expect, it } from 'vitest';
import { ALICE, BOB, fail, hang, renderRoute, installMockApi } from '../test/utils';

/** 60 answers, 45 right: 75%. happy is always right, sad always wrong. */
function aliceAnswers(): Array<[Emotion, Emotion]> {
  const out: Array<[Emotion, Emotion]> = [];
  for (let i = 0; i < 45; i++) out.push(['happy', 'happy']);
  for (let i = 0; i < 15; i++) out.push(['sad', 'angry']);
  return out;
}

describe('LeaderboardPage', () => {
  it('shows a loading state, not an empty table', () => {
    hang('/api/leaderboard');
    renderRoute('/leaderboard');
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows the server error', async () => {
    fail('/api/leaderboard', 'Leaderboard offline');
    renderRoute('/leaderboard');
    expect(await screen.findByRole('alert')).toHaveTextContent('Leaderboard offline');
  });

  it('ranks players, lists unranked ones with answers still needed, and explains the mix', async () => {
    const api = installMockApi();
    api.seedRound(ALICE.id, aliceAnswers());
    api.seedRound(BOB.id, [
      ['happy', 'happy'],
      ['sad', 'sad'],
    ]);
    renderRoute('/leaderboard');
    const table = await screen.findByRole('table', { name: /leaderboard/i });
    const row = within(table).getByRole('row', { name: /alice/i });
    const cells = within(row)
      .getAllByRole('cell')
      .map((c) => c.textContent);
    expect(cells).toEqual(['1', 'Alice', '75%', '60', 'Happy', 'Sad']);
    expect(screen.getByRole('columnheader', { name: /answers in window/i })).toBeInTheDocument();
    expect(within(table).queryByText('Bob')).not.toBeInTheDocument();

    // minAnswers (50) comes from the server response: 50 - 2 answers.
    const unranked = screen.getByRole('list', { name: /not yet ranked/i });
    expect(within(unranked).getByText('Bob')).toBeInTheDocument();
    expect(within(unranked).getByText(/needs 48 more answers/i)).toBeInTheDocument();

    expect(screen.getByText(/last 200 answers/i)).toBeInTheDocument();
    expect(screen.getByText(/weakest emotions/i)).toBeInTheDocument();
  });

  it('shows only the unranked list when nobody has enough answers yet', async () => {
    installMockApi();
    renderRoute('/leaderboard');
    expect(await screen.findByText(/nobody is ranked yet/i)).toBeInTheDocument();
    expect(screen.getByRole('list', { name: /not yet ranked/i })).toBeInTheDocument();
  });

  it('computes answers still needed from the window count the server ranks on', async () => {
    const base = {
      player: BOB,
      rank: null,
      accuracy: 0.5,
      avgPoints: 50,
      bestEmotion: null,
      worstEmotion: null,
    };
    server.use(
      http.get('/api/leaderboard', () =>
        HttpResponse.json({
          windowSize: 100,
          minAnswers: 50,
          entries: [{ ...base, windowAnswered: 10, windowCorrect: 5, totalAnswered: 400 }],
        }),
      ),
    );
    renderRoute('/leaderboard');
    expect(await screen.findByText(/needs 40 more answers/i)).toBeInTheDocument();
  });

  it('omits the not-yet-ranked section when everyone is ranked', async () => {
    const api = installMockApi({ players: [ALICE] });
    api.seedRound(ALICE.id, aliceAnswers());
    renderRoute('/leaderboard');
    await screen.findByRole('table', { name: /leaderboard/i });
    expect(screen.queryByRole('heading', { name: /not yet ranked/i })).not.toBeInTheDocument();
  });
});
