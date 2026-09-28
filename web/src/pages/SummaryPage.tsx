import { Link, useParams } from 'react-router-dom';
import { useRoundSummary } from '../api/queries';
import { AccuracyBar } from '../components/AccuracyBar';
import { ErrorMessage, Loading } from '../components/Feedback';
import { emotionLabel } from '../lib/format';

export function SummaryPage() {
  const { roundId = '' } = useParams();
  const summary = useRoundSummary(roundId);

  if (summary.isPending) return <Loading label="Loading results…" />;
  if (summary.isError) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <ErrorMessage error={summary.error} what="Could not load the round" />
      </main>
    );
  }
  const { round, perEmotion } = summary.data;
  const btn = 'rounded-lg px-6 py-3 text-lg font-semibold';
  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-4xl font-bold">Round complete</h1>
      <p className="mt-2 text-6xl font-bold tabular-nums" aria-label="Score">
        {round.correct} / {round.answered}
      </p>
      <table className="mt-6 w-full text-left text-lg">
        <caption className="sr-only">Score by emotion</caption>
        <thead>
          <tr className="text-sm text-slate-500">
            <th scope="col" className="py-2">
              Emotion
            </th>
            <th scope="col">Correct</th>
            <th scope="col">Accuracy</th>
          </tr>
        </thead>
        <tbody>
          {perEmotion.map((t) => (
            <tr key={t.emotion} className="border-t">
              <th scope="row" className="py-2 font-medium">
                {emotionLabel(t.emotion)}
              </th>
              <td className="tabular-nums">
                {t.answered === 0 ? '—' : `${t.correct} / ${t.answered}`}
              </td>
              <td>
                <AccuracyBar accuracy={t.accuracy} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link to={`/players/${round.playerId}/play`} className={`${btn} bg-slate-900 text-white`}>
          Play again
        </Link>
        <Link
          to={`/players/${round.playerId}/stats`}
          className={`${btn} bg-white ring-1 ring-slate-300`}
        >
          View stats
        </Link>
        <Link to="/leaderboard" className={`${btn} bg-white ring-1 ring-slate-300`}>
          See leaderboard
        </Link>
      </div>
    </main>
  );
}
