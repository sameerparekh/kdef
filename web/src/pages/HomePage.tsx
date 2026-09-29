import { CreatePlayerRequest, type Player } from '@kdef/shared';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useCreatePlayer, useDeletePlayer, usePlayers } from '../api/queries';
import { ErrorMessage, Loading } from '../components/Feedback';
import { clearLastPlayerId, setLastPlayerId } from '../lib/lastPlayer';

/** Offered swatches; leaving it unset lets the server choose. */
const SWATCHES = ['#e11d48', '#ea580c', '#ca8a04', '#16a34a', '#0891b2', '#2563eb', '#7c3aed'];

function PlayerTile({ player }: { player: Player }) {
  const [confirming, setConfirming] = useState(false);
  const del = useDeletePlayer();
  return (
    <li
      className="flex flex-col overflow-hidden rounded-2xl shadow"
      style={{ backgroundColor: player.color }}
    >
      <Link
        to={`/players/${player.id}/play`}
        onClick={() => setLastPlayerId(player.id)}
        className="flex min-h-32 items-center justify-center p-4 text-center text-3xl font-bold text-white"
      >
        {player.displayName}
      </Link>
      <div className="flex items-center justify-between gap-2 bg-black/20 px-3 py-2 text-white">
        {confirming ? (
          <div
            role="group"
            aria-label={`Confirm delete ${player.displayName}`}
            className="flex flex-wrap items-center gap-2"
          >
            <span>Delete all their answers too?</span>
            <button
              type="button"
              className="rounded bg-white px-3 py-2 font-semibold text-red-700"
              disabled={del.isPending}
              onClick={() =>
                del.mutate(player.id, { onSuccess: () => clearLastPlayerId(player.id) })
              }
            >
              Yes, delete
            </button>
            <button
              type="button"
              className="rounded bg-black/30 px-3 py-2"
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
            {del.isError ? <ErrorMessage error={del.error} /> : null}
          </div>
        ) : (
          <>
            <Link
              to={`/players/${player.id}/stats`}
              onClick={() => setLastPlayerId(player.id)}
              className="rounded px-3 py-2 underline"
            >
              Stats
            </Link>
            <button
              type="button"
              aria-label={`Delete ${player.displayName}`}
              className="rounded px-3 py-2 underline"
              onClick={() => setConfirming(true)}
            >
              Delete
            </button>
          </>
        )}
      </div>
    </li>
  );
}

function AddPlayerForm() {
  const create = useCreatePlayer();
  const [name, setName] = useState('');
  const [color, setColor] = useState<string | undefined>();
  const [validation, setValidation] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = CreatePlayerRequest.safeParse({ displayName: name, color });
    if (!parsed.success) {
      setValidation('Enter a name of 1-30 characters');
      return;
    }
    setValidation(null);
    create.mutate(parsed.data, {
      onSuccess: () => {
        setName('');
        setColor(undefined);
      },
    });
  }

  const problem = validation ?? (create.isError ? create.error.message : null);
  return (
    <form onSubmit={submit} className="mt-8 rounded-2xl bg-white p-4 shadow" noValidate>
      <h2 className="text-xl font-semibold">Add player</h2>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-sm text-slate-600">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="min-w-56 rounded-lg border border-slate-300 px-3 py-3 text-lg"
          />
        </label>
        <div role="group" aria-label="Colour" className="flex gap-2 pb-1">
          {SWATCHES.map((s) => (
            <button
              key={s}
              type="button"
              aria-label={`Colour ${s}`}
              aria-pressed={color === s}
              onClick={() => setColor(color === s ? undefined : s)}
              className={`h-10 w-10 rounded-full border-4 ${color === s ? 'border-slate-900' : 'border-transparent'}`}
              style={{ backgroundColor: s }}
            />
          ))}
        </div>
        <button
          type="submit"
          disabled={create.isPending}
          className="rounded-lg bg-slate-900 px-5 py-3 text-lg font-semibold text-white disabled:opacity-50"
        >
          Add player
        </button>
      </div>
      {problem ? (
        <p role="alert" className="mt-3 text-red-700">
          {problem}
        </p>
      ) : null}
    </form>
  );
}

export function HomePage() {
  const players = usePlayers();
  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="text-4xl font-bold">Who&apos;s playing?</h1>
      <div className="mt-6">
        {players.isPending ? (
          <Loading label="Loading players…" />
        ) : players.isError ? (
          <ErrorMessage error={players.error} what="Could not load players" />
        ) : players.data.players.length === 0 ? (
          <p className="text-slate-600">No players yet. Add one below to start.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-4 md:grid-cols-3">
            {players.data.players.map((p) => (
              <PlayerTile key={p.id} player={p} />
            ))}
          </ul>
        )}
      </div>
      <AddPlayerForm />
    </main>
  );
}
