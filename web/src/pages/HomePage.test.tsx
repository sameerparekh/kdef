import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ALICE, BOB, fail, hang, renderRoute, installMockApi } from '../test/utils';

describe('HomePage (Who is playing?)', () => {
  it('shows a loading state, never an empty player list, while players load', () => {
    hang('/api/players');
    renderRoute('/');
    expect(screen.getByRole('status')).toHaveTextContent(/loading players/i);
    expect(screen.queryByText(/no players yet/i)).not.toBeInTheDocument();
  });

  it('shows the server error message when players fail to load', async () => {
    fail('/api/players', 'Database is on fire');
    renderRoute('/');
    expect(await screen.findByRole('alert')).toHaveTextContent('Database is on fire');
  });

  it("shows a tile per player linking to that player's quiz", async () => {
    installMockApi();
    renderRoute('/');
    const alice = await screen.findByRole('link', { name: /alice/i });
    expect(alice).toHaveAttribute('href', `/players/${ALICE.id}/play`);
    expect(screen.getByRole('link', { name: /bob/i })).toHaveAttribute(
      'href',
      `/players/${BOB.id}/play`,
    );
  });

  it('invites the first player when there are none (a real empty state, after loading)', async () => {
    installMockApi({ players: [] });
    renderRoute('/');
    expect(await screen.findByText(/no players yet/i)).toBeInTheDocument();
  });

  it('adds a player and shows the new tile', async () => {
    installMockApi();
    const user = userEvent.setup();
    renderRoute('/');
    await screen.findByRole('link', { name: /alice/i });
    await user.type(screen.getByLabelText(/name/i), 'Carol');
    await user.click(screen.getByRole('button', { name: /add player/i }));
    expect(await screen.findByRole('link', { name: /carol/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/name/i)).toHaveValue('');
  });

  it('shows the 409 message for a duplicate name (case-insensitive)', async () => {
    installMockApi();
    const user = userEvent.setup();
    renderRoute('/');
    await screen.findByRole('link', { name: /alice/i });
    await user.type(screen.getByLabelText(/name/i), 'ALICE');
    await user.click(screen.getByRole('button', { name: /add player/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/already exists/i);
  });

  it('validates an empty or too-long name without calling the server', async () => {
    installMockApi();
    const user = userEvent.setup();
    renderRoute('/');
    await screen.findByRole('link', { name: /alice/i });
    await user.click(screen.getByRole('button', { name: /add player/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/1-30 characters/i);
    await user.type(screen.getByLabelText(/name/i), 'x'.repeat(31));
    await user.click(screen.getByRole('button', { name: /add player/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/1-30 characters/i);
  });

  it('asks for confirmation before deleting, and can cancel', async () => {
    const api = installMockApi();
    const user = userEvent.setup();
    renderRoute('/');
    await screen.findByRole('link', { name: /alice/i });
    await user.click(screen.getByRole('button', { name: /delete alice/i }));
    const confirm = screen.getByRole('group', { name: /confirm delete alice/i });
    await user.click(within(confirm).getByRole('button', { name: /cancel/i }));
    expect(screen.getByRole('link', { name: /alice/i })).toBeInTheDocument();
    expect(api.state.players).toHaveLength(2);
  });

  it('deletes a player after confirmation', async () => {
    const api = installMockApi();
    const user = userEvent.setup();
    renderRoute('/');
    await screen.findByRole('link', { name: /alice/i });
    await user.click(screen.getByRole('button', { name: /delete alice/i }));
    const confirm = screen.getByRole('group', { name: /confirm delete alice/i });
    await user.click(within(confirm).getByRole('button', { name: /yes, delete/i }));
    await screen.findByRole('link', { name: /bob/i });
    expect(screen.queryByRole('link', { name: /alice/i })).not.toBeInTheDocument();
    expect(api.state.players.map((p) => p.displayName)).toEqual(['Bob']);
  });
});
