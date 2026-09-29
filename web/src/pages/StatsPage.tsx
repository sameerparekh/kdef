import { EMOTIONS, type ConfusionCell, type EmotionTally, type PlayerStats } from '@kdef/shared';
import { Link, useParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { usePlayerStats } from '../api/queries';
import { AccuracyBar } from '../components/AccuracyBar';
import { ErrorMessage, Loading } from '../components/Feedback';
import { angleLabel, emotionLabel, formatAccuracy } from '../lib/format';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8 rounded-2xl bg-white p-4 shadow">
      <h2 className="mb-3 text-xl font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function EmotionAccuracy({ perEmotion }: { perEmotion: EmotionTally[] }) {
  const data = perEmotion.map((t) => ({
    name: emotionLabel(t.emotion),
    percent: t.accuracy === null ? null : Math.round(t.accuracy * 100),
  }));
  return (
    <Section title="Accuracy by emotion">
      <div className="h-64" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="name" />
            <YAxis domain={[0, 100]} unit="%" />
            <Tooltip />
            <Bar dataKey="percent" fill="#10b981" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <table aria-label="Accuracy by emotion" className="sr-only">
        <tbody>
          {perEmotion.map((t) => (
            <tr key={t.emotion}>
              <th scope="row">{emotionLabel(t.emotion)}</th>
              <td>{formatAccuracy(t.accuracy)}</td>
              <td>{t.answered} answered</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

function AngleAccuracy({ perAngle }: { perAngle: PlayerStats['perAngle'] }) {
  return (
    <Section title="Accuracy by camera angle">
      <ul className="space-y-2">
        {perAngle.map((t) => (
          <li key={t.angle} className="flex items-center justify-between gap-4">
            <span className="font-medium">{angleLabel(t.angle)}</span>
            <span className="flex items-center gap-3">
              <AccuracyBar accuracy={t.accuracy} />
              <span className="w-24 text-right text-sm text-slate-500">{t.answered} answered</span>
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function ConfusionHeatmap({ confusion }: { confusion: ConfusionCell[] }) {
  const count = (actual: string, chosen: string) =>
    confusion.find((c) => c.actual === actual && c.chosen === chosen)?.count ?? 0;
  return (
    <Section title="Confusion matrix">
      <p className="mb-2 text-sm text-slate-600">
        Rows are the real emotion, columns what you chose. Darker means a larger share of that row.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full table-fixed border-separate border-spacing-1 text-center text-sm">
          <thead>
            <tr>
              <th scope="col" className="w-20" />
              {EMOTIONS.map((e) => (
                <th key={e} scope="col" className="font-medium text-slate-600">
                  {emotionLabel(e)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {EMOTIONS.map((actual) => {
              const rowTotal = EMOTIONS.reduce((sum, chosen) => sum + count(actual, chosen), 0);
              return (
                <tr key={actual}>
                  <th scope="row" className="text-right font-medium text-slate-600">
                    {emotionLabel(actual)}
                  </th>
                  {EMOTIONS.map((chosen) => {
                    const n = count(actual, chosen);
                    const share = rowTotal === 0 ? 0 : n / rowTotal;
                    return (
                      <td
                        key={chosen}
                        aria-label={`Actual ${actual}, chosen ${chosen}: ${n}`}
                        className="h-12 rounded tabular-nums"
                        style={{
                          backgroundColor: `rgba(79, 70, 229, ${share})`,
                          color: share > 0.5 ? 'white' : undefined,
                        }}
                      >
                        {n === 0 ? <span className="text-slate-300">·</span> : n}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function RecentRounds({ rounds }: { rounds: PlayerStats['recentRounds'] }) {
  return (
    <Section title="Recent rounds">
      {rounds.length === 0 ? (
        <p className="text-slate-600">No completed rounds yet.</p>
      ) : (
        <ul aria-label="Recent rounds" className="divide-y">
          {rounds.map((r) => (
            <li key={r.id} className="flex items-center justify-between py-2">
              <span>{new Date(r.startedAt).toLocaleDateString()}</span>
              <span className="tabular-nums">
                {r.correct} / {r.answered}
              </span>
              <Link to={`/rounds/${r.id}/summary`} className="text-indigo-700 underline">
                Details
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export function StatsPage() {
  const { playerId = '' } = useParams();
  const stats = usePlayerStats(playerId);

  if (stats.isPending) return <Loading label="Loading stats…" />;
  if (stats.isError) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <ErrorMessage error={stats.error} what="Could not load stats" />
      </main>
    );
  }
  const s = stats.data;
  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="text-4xl font-bold">{s.player.displayName}&apos;s stats</h1>
      {s.totalAnswered === 0 ? (
        <p className="mt-4 text-lg text-slate-600">
          No answers yet. Play a round and the charts will appear here.
        </p>
      ) : (
        <>
          <p className="mt-2 text-lg text-slate-600">
            {s.totalCorrect} correct out of {s.totalAnswered} answers
          </p>
          <EmotionAccuracy perEmotion={s.perEmotion} />
          <AngleAccuracy perAngle={s.perAngle} />
          <ConfusionHeatmap confusion={s.confusion} />
        </>
      )}
      <RecentRounds rounds={s.recentRounds} />
    </main>
  );
}
