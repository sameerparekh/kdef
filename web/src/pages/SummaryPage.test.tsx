import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ALICE, fail, hang, renderRoute, installMockApi } from '../test/utils';

function seeded() {
  const api = installMockApi();
  const roundId = api.seedRound(ALICE.id, [
    ['angry', 'angry'],
    ['happy', 'sad'],
    ['sad', 'sad'],
    ['fear', 'fear'],
  ]);
  return { api, roundId };
}

describe('SummaryPage', () => {
  it('shows a loading state, not a 0 score', () => {
    hang('/api/rounds/abc');
    renderRoute('/rounds/abc/summary');
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText(/\/ 0/)).not.toBeInTheDocument();
  });

  it('shows the server error', async () => {
    fail('/api/rounds/abc', 'Round exploded');
    renderRoute('/rounds/abc/summary');
    expect(await screen.findByRole('alert')).toHaveTextContent('Round exploded');
  });

  it('shows the score and a per-emotion breakdown', async () => {
    const { roundId } = seeded();
    renderRoute(`/rounds/${roundId}/summary`);
    expect(await screen.findByRole('heading', { name: /round complete/i })).toBeInTheDocument();
    expect(screen.getByText('3 / 4')).toBeInTheDocument();
    const happy = screen.getByRole('row', { name: /happy/i });
    expect(within(happy).getByText('0 / 1')).toBeInTheDocument();
    const angry = screen.getByRole('row', { name: /angry/i });
    expect(within(angry).getByText('1 / 1')).toBeInTheDocument();
    // An emotion that did not come up is shown as not asked, not as 0%.
    const disgust = screen.getByRole('row', { name: /disgust/i });
    expect(within(disgust).getByText('not asked')).toBeInTheDocument();
  });

  it('offers play again, stats and leaderboard', async () => {
    const { roundId } = seeded();
    renderRoute(`/rounds/${roundId}/summary`);
    await screen.findByRole('heading', { name: /round complete/i });
    expect(screen.getByRole('link', { name: /play again/i })).toHaveAttribute(
      'href',
      `/players/${ALICE.id}/play`,
    );
    expect(screen.getByRole('link', { name: /view stats/i })).toHaveAttribute(
      'href',
      `/players/${ALICE.id}/stats`,
    );
    expect(screen.getByRole('link', { name: /see leaderboard/i })).toHaveAttribute(
      'href',
      '/leaderboard',
    );
  });
});
