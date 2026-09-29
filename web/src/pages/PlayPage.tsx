import { useEffect, useRef } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useStartRound } from '../api/queries';
import { ErrorMessage, Loading } from '../components/Feedback';
import { setLastPlayerId } from '../lib/lastPlayer';

/** /players/:playerId/play: starts a new round, then hands over to the quiz. */
export function PlayPage() {
  const { playerId = '' } = useParams();
  const start = useStartRound();
  const started = useRef(false);

  useEffect(() => {
    // The ref keeps StrictMode's double effect from starting two rounds.
    if (started.current) return;
    started.current = true;
    setLastPlayerId(playerId);
    start.mutate(playerId);
  }, [playerId]);

  if (start.isError) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <ErrorMessage error={start.error} what="Could not start a round" />
      </main>
    );
  }
  if (start.isSuccess) return <Navigate to={`/rounds/${start.data.id}`} replace />;
  return <Loading label="Starting round…" />;
}
