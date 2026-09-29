import { Link } from 'react-router-dom';
import { useLeaderboard } from '../api/queries';
import { ErrorMessage, Loading } from '../components/Feedback';
import { emotionLabel, formatAccuracy } from '../lib/format';

export function LeaderboardPage() {
  const board = useLeaderboard();

  if (board.isPending) return <Loading label="Loading leaderboard…" />;
  if (board.isError) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <ErrorMessage error={board.error} what="Could not load the leaderboard" />
      </main>
    );
  }
  const { windowSize, minAnswers, entries } = board.data;
  const ranked = entries.filter((e) => e.rank !== null).sort((a, b) => a.rank! - b.rank!);
  const unranked = entries.filter((e) => e.rank === null);
  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="text-4xl font-bold">Leaderboard</h1>
      <p className="mt-2 text-slate-600">
        Accuracy over each player&apos;s last {windowSize} answers. You need {minAnswers} answers to
        be ranked.
      </p>
      <p className="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
        The quiz serves each player their weakest emotions, so accuracy is measured on a harder mix
        for stronger players.
      </p>

      {ranked.length === 0 ? (
        <p className="mt-6 text-lg text-slate-600">Nobody is ranked yet.</p>
      ) : (
        <table aria-label="Leaderboard" className="mt-6 w-full text-left text-lg">
          <thead>
            <tr className="text-sm text-slate-500">
              <th scope="col">Rank</th>
              <th scope="col">Player</th>
              <th scope="col">Accuracy</th>
              <th scope="col">Answers in window</th>
              <th scope="col">Best</th>
              <th scope="col">Worst</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((e) => (
              <tr key={e.player.id} className="border-t">
                <td className="py-3 font-bold tabular-nums">{e.rank}</td>
                <td>
                  <span
                    aria-hidden="true"
                    className="mr-2 inline-block h-3 w-3 rounded-full"
                    style={{ backgroundColor: e.player.color }}
                  />
                  {e.player.displayName}
                </td>
                <td className="tabular-nums">{formatAccuracy(e.accuracy)}</td>
                <td className="tabular-nums">{e.windowAnswered}</td>
                <td>{e.bestEmotion ? emotionLabel(e.bestEmotion) : '—'}</td>
                <td>{e.worstEmotion ? emotionLabel(e.worstEmotion) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {unranked.length > 0 ? (
        <>
          <h2 className="mt-8 text-xl font-semibold">Not yet ranked</h2>
          <ul aria-label="Not yet ranked" className="mt-2 divide-y">
            {unranked.map((e) => (
              <li key={e.player.id} className="flex items-center justify-between py-2">
                <Link to={`/players/${e.player.id}/play`} className="font-medium">
                  {e.player.displayName}
                </Link>
                <span className="text-slate-600">
                  needs {Math.max(minAnswers - e.windowAnswered, 0)} more answers
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </main>
  );
}
