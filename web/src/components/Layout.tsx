import { useSyncExternalStore } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { getLastPlayerId, subscribeLastPlayer } from '../lib/lastPlayer';

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-4 py-2 text-lg font-medium ${isActive ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-200'}`;

export function Layout() {
  const lastPlayerId = useSyncExternalStore(subscribeLastPlayer, getLastPlayerId);
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
      <div className="flex-1">
        <Outlet />
      </div>
    </div>
  );
}
