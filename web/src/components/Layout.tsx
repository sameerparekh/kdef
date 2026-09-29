import { useState, useSyncExternalStore } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { getLastPlayerId, subscribeLastPlayer } from '../lib/lastPlayer';

/** Outlet context: lets a page speak through the app-wide live region. */
export type AnnounceContext = { announce: (text: string) => void };

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-4 py-2 text-lg font-medium ${isActive ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-200'}`;

export function Layout() {
  const lastPlayerId = useSyncExternalStore(subscribeLastPlayer, getLastPlayerId);
  const [announced, setAnnounced] = useState('');
  return (
    <div className="flex min-h-dvh flex-col">
      <nav aria-label="Main" className="flex items-center gap-2 border-b bg-white px-4 py-2">
        <NavLink to="/" end className={linkClass}>
          Home
        </NavLink>
        <NavLink to="/leaderboard" className={linkClass}>
          Leaderboard
        </NavLink>
        {lastPlayerId ? (
          <NavLink to={`/players/${lastPlayerId}/stats`} className={linkClass}>
            My stats
          </NavLink>
        ) : null}
        {import.meta.env.VITE_MOCK_API === 'true' ? (
          <span className="ml-auto rounded bg-amber-100 px-2 py-1 text-sm text-amber-800">
            Mock API
          </span>
        ) : null}
      </nav>
      {/* Mounted for the whole session, above every route, so a message set just before a page
          change (the last answer of a round) is still there for the screen reader. No role, so it
          is not a second role=status next to loading indicators. */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {announced}
      </div>
      <div className="flex-1">
        <Outlet context={{ announce: setAnnounced } satisfies AnnounceContext} />
      </div>
    </div>
  );
}
