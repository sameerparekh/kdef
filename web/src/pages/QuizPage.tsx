import { EMOTIONS, type AnswerResponse, type Emotion, type Question } from '@kdef/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { ApiRequestError } from '../api/client';
import { qk, useCurrentQuestion, useSubmitAnswer } from '../api/queries';
import { ErrorMessage, Loading } from '../components/Feedback';
import { emotionLabel } from '../lib/format';
import type { AnnounceContext } from '../components/Layout';
import { Celebration } from '../components/Celebration';
import { pickCelebration } from '../lib/celebration';

/** Alt text must never reveal the emotion, so it is generic. */
const FACE_ALT = 'Face to identify';
const CONTRAST_ALT = 'Same person, for comparison';

function ProgressBar({
  position,
  total,
  done,
}: {
  position: number;
  total: number;
  done: boolean;
}) {
  const completed = done ? position : position - 1;
  return (
    <div>
      <p className="text-sm font-medium text-slate-600">
        Question {position} of {total}
      </p>
      <div
        role="progressbar"
        aria-label="Round progress"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={completed}
        className="mt-1 h-2 overflow-hidden rounded-full bg-slate-200"
      >
        <div
          className="h-full bg-emerald-500 transition-all"
          style={{ width: `${(completed / total) * 100}%` }}
        />
      </div>
    </div>
  );
}

/**
 * The result line. The corner of the quiz for what follows an answer: the timer and points of a
 * scored round can sit beside the banner in FeedbackRow. `message` is the cheerful line for a hit.
 */
function FeedbackBanner({ result, message }: { result: AnswerResponse; message: string }) {
  return result.correct ? (
    <p className="rounded-lg bg-emerald-100 px-4 py-2 text-xl font-bold text-emerald-800">
      <span aria-hidden="true">✓</span> <span>{message}</span>
    </p>
  ) : (
    <p className="rounded-lg bg-red-100 px-4 py-2 text-xl font-bold text-red-800">
      ✗ Not quite: it was {emotionLabel(result.correctEmotion)}
    </p>
  );
}

/**
 * The words a screen reader speaks for an answer, in the live region owned by Layout. The wording
 * differs from the banner's so that text queries on the banner (`/not quite/i`, `/it was X$/`)
 * still match one element; the banner itself is not announced (it has no status role).
 */
function announcement(result: AnswerResponse): string {
  return result.correct
    ? 'Correct.'
    : `Incorrect. The answer was ${emotionLabel(result.correctEmotion)}.`;
}

function QuestionView({
  question,
  onNext,
  onComplete,
  onAnnounce,
}: {
  question: Question;
  onNext: () => void;
  onComplete: () => void;
  onAnnounce: (text: string) => void;
}) {
  const submit = useSubmitAnswer();
  const inFlight = useRef(false);
  const result = submit.data ?? null;
  const answering = submit.isPending;
  // Drawn once per question (QuestionView remounts per question, and state survives re-renders).
  const [celebration] = useState(pickCelebration);

  // Clear the previous result when a question appears, so it is never read against the wrong
  // question and an identical result next time is a change the screen reader speaks.
  useEffect(() => {
    onAnnounce('');
    // Mount only: onAnnounce is a stable state setter.
  }, []);
  useEffect(() => {
    if (result) onAnnounce(announcement(result));
    // Only [result]: same stable setter.
  }, [result]);

  function answer(emotion: Emotion) {
    // A ref, not render state: a second key can arrive before React re-renders.
    if (result || inFlight.current) return;
    inFlight.current = true;
    submit.mutate(
      { questionId: question.questionId, emotion },
      {
        onError: (err) => {
          if (err instanceof ApiRequestError && err.status === 409) {
            // Already answered (another tab or a duplicate request): move on via /next.
            onNext();
          } else {
            inFlight.current = false;
          }
        },
      },
    );
  }

  function advance() {
    if (result?.roundComplete) onComplete();
    else onNext();
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Enter') {
        // A focused button handles Enter itself via click.
        if (result && !(e.target instanceof HTMLButtonElement)) {
          e.preventDefault();
          advance();
        }
        return;
      }
      const emotion = /^[1-7]$/.test(e.key) ? EMOTIONS[Number(e.key) - 1] : undefined;
      if (emotion) answer(emotion);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <main className="mx-auto flex h-[calc(100dvh-3.5rem)] max-w-5xl flex-col gap-2 p-3">
      <ProgressBar position={question.position} total={question.total} done={result !== null} />
      <div className="flex min-h-0 flex-1 items-center justify-center gap-4">
        <img
          src={question.imageUrl}
          alt={FACE_ALT}
          style={{ aspectRatio: '562 / 762' }}
          className="h-full max-h-full min-h-0 rounded-xl object-cover shadow"
        />
        {result && !result.correct && result.contrastImageUrl ? (
          <figure className="flex h-full min-h-0 flex-col items-center gap-1">
            <img
              src={result.contrastImageUrl}
              alt={CONTRAST_ALT}
              style={{ aspectRatio: '562 / 762' }}
              className="min-h-0 flex-1 rounded-xl object-cover shadow"
            />
            <figcaption className="text-center text-sm text-slate-700">
              What {emotionLabel(result.chosenEmotion)} looks like on this person
            </figcaption>
          </figure>
        ) : null}
      </div>
      {result?.correct ? <Celebration kind={celebration.kind} /> : null}
      <div className="flex min-h-14 items-center gap-3">
        {result ? (
          <>
            <FeedbackBanner result={result} message={celebration.message} />
            <button
              type="button"
              onClick={advance}
              className="ml-auto rounded-lg bg-slate-900 px-6 py-3 text-lg font-semibold text-white"
            >
              {result.roundComplete ? 'See results' : 'Next'}
            </button>
          </>
        ) : submit.isError ? (
          <ErrorMessage error={submit.error} what="Could not save your answer, try again" />
        ) : null}
      </div>
      <div className="grid grid-cols-4 gap-2 md:grid-cols-7">
        {EMOTIONS.map((emotion, i) => (
          <button
            key={emotion}
            type="button"
            disabled={result !== null || answering}
            onClick={() => answer(emotion)}
            className="flex min-h-16 flex-col items-center justify-center rounded-xl bg-white text-lg font-semibold shadow ring-1 ring-slate-300 enabled:hover:bg-slate-100 disabled:opacity-50"
          >
            <span className="text-xs text-slate-500">{i + 1}</span>
            <span>{emotionLabel(emotion)}</span>
          </button>
        ))}
      </div>
    </main>
  );
}

export function QuizPage() {
  const { roundId = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const current = useCurrentQuestion(roundId);
  const { announce } = useOutletContext<AnnounceContext>();

  return (
    <>
      {current.isPending ? (
        <Loading label="Loading question…" />
      ) : current.isError ? (
        <main className="mx-auto max-w-3xl p-6">
          <ErrorMessage error={current.error} what="Could not load the question" />
        </main>
      ) : current.data.status === 'complete' ? (
        <Navigate to={`/rounds/${roundId}/summary`} replace />
      ) : (
        <QuestionView
          key={current.data.question.questionId}
          question={current.data.question}
          onNext={() => void qc.resetQueries({ queryKey: qk.next(roundId) })}
          onComplete={() => navigate(`/rounds/${roundId}/summary`)}
          onAnnounce={announce}
        />
      )}
    </>
  );
}
