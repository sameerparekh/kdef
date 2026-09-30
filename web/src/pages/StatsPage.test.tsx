import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ALICE, fail, hang, renderRoute, installMockApi } from '../test/utils';

const url = `/players/${ALICE.id}/stats`;

describe('StatsPage', () => {
  it('shows a loading state, not zeros or an empty chart', () => {
    hang(`/api/players/${ALICE.id}/stats`);
    renderRoute(url);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText(/no answers yet/i)).not.toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
    expect(screen.queryByText(/points/i)).not.toBeInTheDocument();
  });

  it('shows the server error', async () => {
    fail(`/api/players/${ALICE.id}/stats`, 'Stats unavailable');
    renderRoute(url);
    expect(await screen.findByRole('alert')).toHaveTextContent('Stats unavailable');
  });

  it('says so when the player has no answers yet', async () => {
    installMockApi();
    renderRoute(url);
    expect(await screen.findByText(/no answers yet/i)).toBeInTheDocument();
  });

  describe('with answers', () => {
    function seeded() {
      const api = installMockApi();
      // angles cycle frontal, half_left, half_right, unknown
      api.seedRound(ALICE.id, [
        ['happy', 'happy'],
        ['happy', 'sad'],
        ['happy', 'sad'],
        ['sad', 'sad'],
      ]);
      renderRoute(url);
    }

    it('shows per-emotion accuracy, with unasked emotions as not asked rather than 0%', async () => {
      seeded();
      await screen.findByRole('heading', { name: /accuracy by emotion/i });
      const table = screen.getByRole('table', { name: /accuracy by emotion/i });
      expect(
        within(within(table).getByRole('row', { name: /happy/i })).getByText('33%'),
      ).toBeInTheDocument();
      expect(
        within(within(table).getByRole('row', { name: /sad/i })).getByText('100%'),
      ).toBeInTheDocument();
      expect(
        within(within(table).getByRole('row', { name: /fear/i })).getByText('not asked'),
      ).toBeInTheDocument();
    });

    it('shows total and average points', async () => {
      const api = installMockApi();
      // 100 + 0 + 50 + 0 = 150 points over 4 answers
      api.seedRound(ALICE.id, [
        ['happy', 'happy'],
        ['happy', 'sad'],
        ['sad', 'sad', 5000],
        ['fear', 'angry'],
      ]);
      renderRoute(url);
      expect(await screen.findByText(/points in total/i)).toHaveTextContent(
        '150 points in total, 37.5 on average per answer',
      );
    });

    it('labels angles in plain words', async () => {
      seeded();
      await screen.findByRole('heading', { name: /accuracy by camera angle/i });
      for (const name of ['Frontal', 'Turned left', 'Turned right', 'Unknown']) {
        expect(screen.getByText(name)).toBeInTheDocument();
      }
      expect(screen.queryByText(/half_left/)).not.toBeInTheDocument();
    });

    it('renders the confusion heatmap with counts (rows actual, columns chosen)', async () => {
      seeded();
      await screen.findByRole('heading', { name: /confusion/i });
      expect(screen.getByLabelText('Actual happy, chosen sad: 2')).toHaveTextContent('2');
      expect(screen.getByLabelText('Actual happy, chosen happy: 1')).toHaveTextContent('1');
      expect(screen.getByLabelText('Actual sad, chosen sad: 1')).toBeInTheDocument();
      expect(screen.getByLabelText('Actual angry, chosen fear: 0')).toBeInTheDocument();
    });

    it('lists recent rounds', async () => {
      seeded();
      const list = await screen.findByRole('list', { name: /recent rounds/i });
      expect(within(list).getByText('2 / 4')).toBeInTheDocument();
    });
  });
});
