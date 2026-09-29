import { EMOTIONS, type AnswerResponse, type Emotion, type Question } from '@kdef/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { ApiRequestError } from '../api/client';
import { qk, useCurrentQuestion, useSubmitAnswer } from '../api/queries';
import { ErrorMessage, Loading } from '../components/Feedback';
import { emotionLabel } from '../lib/format';

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

function FeedbackBanner({ result }: { result: AnswerResponse }) {
  return result.correct ? (
    <p
      role="status"
      className="rounded-lg bg-emerald-100 px-4 py-2 text-xl font-bold text-emerald-800"
    >
      ✓ Correct!
    </p>
  ) : (
    <p role="status" className="rounded-lg bg-red-100 px-4 py-2 text-xl font-bold text-red-800">
      ✗ Not quite: it was {emotionLabel(result.correctEmotion)}
    </p>
  );
}

function QuestionView({
  question,
  onNext,
  onComplete,
}: {
  question: Question;
  onNext: () => void;
  onComplete: () => void;
}) {
  const submit = useSubmitAnswer();
  const inFlight = useRef(false);
  const result = submit.data ?? null;
  const answering = submit.isPending;

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
      <div className="flex min-h-14 items-center gap-3">
        {result ? (
          <>
            <FeedbackBanner result={result} />
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

  if (current.isPending) return <Loading label="Loading question…" />;
  if (current.isError) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <ErrorMessage error={current.error} what="Could not load the question" />
      </main>
    );
  }
  if (current.data.status === 'complete') {
    return <Navigate to={`/rounds/${roundId}/summary`} replace />;
  }
  const { question } = current.data;
  return (
    <QuestionView
      key={question.questionId}
      question={question}
      onNext={() => void qc.resetQueries({ queryKey: qk.next(roundId) })}
      onComplete={() => navigate(`/rounds/${roundId}/summary`)}
    />
  );
}
