import { formatAccuracy } from '../lib/format';

/** A horizontal bar for an accuracy in [0, 1]. A null accuracy renders as text, never an empty bar. */
export function AccuracyBar({ accuracy }: { accuracy: number | null }) {
  if (accuracy === null) return <span className="text-slate-500">{formatAccuracy(null)}</span>;
  return (
    <span className="flex items-center gap-2">
      <span className="h-3 w-32 overflow-hidden rounded-full bg-slate-200" aria-hidden="true">
        <span
          className="block h-full bg-emerald-500"
          style={{ width: `${Math.round(accuracy * 100)}%` }}
        />
      </span>
      <span className="tabular-nums">{formatAccuracy(accuracy)}</span>
    </span>
  );
}
