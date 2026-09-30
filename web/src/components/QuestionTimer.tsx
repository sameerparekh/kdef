import { useEffect, useState } from 'react';
import { clock } from '../lib/clock';
import { formatSeconds } from '../lib/format';

/** How often the display refreshes: about 10 Hz, so only this small component re-renders. */
export const TIMER_TICK_MS = 100;

/**
 * The count-up timer. It shows a dash until the photo has loaded (`loadedAt` is null), counts
 * from `loadedAt` while running, and shows `stoppedMs` once the player has answered.
 * It has role=timer, which is not a live region, so it never talks over the result announcement.
 */
export function QuestionTimer({
  loadedAt,
  stoppedMs,
}: {
  /** `clock.now()` when the photo finished loading, or null while it has not. */
  loadedAt: number | null;
  /** Elapsed ms frozen at the answer, or null while the question is open. */
  stoppedMs: number | null;
}) {
  const running = loadedAt !== null && stoppedMs === null;
  const [now, setNow] = useState(() => clock.now());

  useEffect(() => {
    if (!running) return;
    setNow(clock.now());
    const id = setInterval(() => setNow(clock.now()), TIMER_TICK_MS);
    return () => clearInterval(id);
  }, [running]);

  const elapsed = stoppedMs ?? (loadedAt === null ? null : Math.max(0, now - loadedAt));
  return (
    <p role="timer" aria-label="Time" className="text-2xl font-semibold tabular-nums">
      {elapsed === null ? '—' : formatSeconds(elapsed)}
    </p>
  );
}
