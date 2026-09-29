import { EMOTIONS } from '@kdef/shared';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ALICE,
  currentQuestion,
  label,
  otherThan,
  renderRoute,
  installMockApi,
} from '../test/utils';
import { server } from '../test/server';
import { CORRECT_ADVANCE_MS } from '../lib/timing';

async function startQuiz(roundLength = 3) {
  const api = installMockApi({ roundLength });
  renderRoute(`/players/${ALICE.id}/play`);
  await screen.findByText(/question 1 of/i);
  return api;
}

/** Fake clock that still ticks in real time, so Testing Library's polling keeps working. */
function useClock() {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  return userEvent.setup({ advanceTimers: (ms) => void vi.advanceTimersByTime(ms) });
}
const pause = (ms = CORRECT_ADVANCE_MS) => act(() => vi.advanceTimersByTimeAsync(ms));

/** Records the API calls the page makes, as `POST /api/...` strings, plus /answer bodies. */
function recordRequests() {
  const calls: string[] = [];
  const answers: unknown[] = [];
  server.events.on('request:start', async ({ request }) => {
    calls.push(`${request.method} ${new URL(request.url).pathname}`);
    if (request.url.includes('/answer')) answers.push(await request.clone().json());
  });
  return { calls, answers, nexts: () => calls.filter((c) => c.endsWith('/next')).length };
}

afterEach(() => {
  vi.useRealTimers();
  server.events.removeAllListeners();
});

const button = (emotion: string) => screen.getByRole('button', { name: new RegExp(emotion, 'i') });

describe('QuizPage', () => {
  it('starts a round from /players/:id/play and shows the first question', async () => {
    await startQuiz(20);
    expect(screen.getByText('Question 1 of 20')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '20');
  });

  it('shows a loading state while the question loads', () => {
    installMockApi();
    server.use(http.post('/api/rounds/:id/next', () => delay('infinite')));
    renderRoute('/rounds/00000000-0000-4000-8000-000000000999');
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows an error when the round cannot be loaded', async () => {
    installMockApi();
    renderRoute('/rounds/00000000-0000-4000-8000-000000000999');
    expect(await screen.findByRole('alert')).toHaveTextContent(/no such round/i);
  });

  it('shows a loading state while a round is being started', () => {
    installMockApi();
    server.use(http.post('/api/players/:id/rounds', () => delay('infinite')));
    renderRoute(`/players/${ALICE.id}/play`);
    expect(screen.getByRole('status')).toHaveTextContent(/starting round/i);
  });

  it('creates exactly one round under StrictMode', async () => {
    const api = installMockApi();
    renderRoute(`/players/${ALICE.id}/play`, { strict: true });
    await screen.findByText(/question 1 of/i);
    expect(api.state.rounds.size).toBe(1);
  });

  it('shows an error when a round cannot be started', async () => {
    installMockApi();
    renderRoute('/players/00000000-0000-4000-8000-000000000998/play');
    expect(await screen.findByRole('alert')).toHaveTextContent(/no such player/i);
  });

  it('renders seven emotion buttons in EMOTIONS order with the digit 1-7 on each', async () => {
    await startQuiz();
    const names = screen
      .getAllByRole('button')
      .map((b) => b.textContent ?? '')
      .filter((t) => /^[1-7]/.test(t));
    expect(names).toEqual(EMOTIONS.map((e, i) => `${i + 1}${label(e)}`));
  });

  it('never puts an emotion name in image alt text', async () => {
    const api = await startQuiz();
    const q = currentQuestion(api);
    const user = userEvent.setup();
    await user.click(button(otherThan(q.emotion)));
    await screen.findByText(/looks like on this person/i);
    const alts = screen.getAllByRole('img').map((i) => i.getAttribute('alt') ?? '');
    expect(alts.length).toBeGreaterThanOrEqual(2);
    for (const alt of alts) {
      for (const e of EMOTIONS) expect(alt.toLowerCase()).not.toContain(e);
    }
  });

  it('keeps the confirmation delay under 300 ms so a correct answer feels immediate', () => {
    expect(CORRECT_ADVANCE_MS).toBeGreaterThan(0);
    expect(CORRECT_ADVANCE_MS).toBeLessThanOrEqual(300);
  });

  it('on a correct answer confirms it, locks the buttons, then goes to the next question', async () => {
    const api = await startQuiz();
    const q = currentQuestion(api);
    const user = userEvent.setup();
    await user.click(button(q.emotion));
    expect(await screen.findByText(/correct!/i)).toBeInTheDocument();
    expect(button(q.emotion)).toBeDisabled();
    expect(button(otherThan(q.emotion))).toBeDisabled();
    expect(screen.queryByText(/looks like on this person/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^next$/i })).not.toBeInTheDocument();
    expect(await screen.findByText('Question 2 of 3')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^next$/i })).not.toBeInTheDocument();
    expect(button('angry')).toBeEnabled();
  });

  it('on a miss waits for the player and does not advance by itself', async () => {
    const user = useClock();
    const api = await startQuiz();
    const q = currentQuestion(api);
    await user.click(button(otherThan(q.emotion)));
    expect(await screen.findByText(/not quite/i)).toBeInTheDocument();
    await pause(CORRECT_ADVANCE_MS * 10);
    expect(screen.getByText('Question 1 of 3')).toBeInTheDocument();
    expect(screen.getByText(/not quite/i)).toBeInTheDocument();
    expect(button(q.emotion)).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /^next$/i }));
    expect(await screen.findByText('Question 2 of 3')).toBeInTheDocument();
  });

  it('after a miss, Enter advances and number keys are ignored', async () => {
    const api = await startQuiz();
    const q = currentQuestion(api);
    const user = userEvent.setup();
    await user.keyboard(String(EMOTIONS.indexOf(otherThan(q.emotion)) + 1));
    await screen.findByText(/not quite/i);
    await user.keyboard(String(EMOTIONS.indexOf(q.emotion) + 1));
    expect(api.state.questions.get(q.id)?.chosen).toBe(otherThan(q.emotion));
    await user.keyboard('{Enter}');
    expect(await screen.findByText('Question 2 of 3')).toBeInTheDocument();
  });

  it('keys pressed during the confirmation pause do nothing until it ends', async () => {
    useClock();
    const api = await startQuiz();
    const q = currentQuestion(api);
    const rec = recordRequests();
    const right = String(EMOTIONS.indexOf(q.emotion) + 1);
    fireEvent.keyDown(window, { key: right });
    await screen.findByText(/correct!/i); // the answer response is in; the pause has begun
    fireEvent.keyDown(window, { key: right });
    fireEvent.keyDown(window, { key: '2' });
    fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.keyDown(window, { key: 'Enter' });
    await pause(10);
    expect(rec.nexts()).toBe(0); // Enter did not cut the pause short
    expect(screen.getByText('Question 1 of 3')).toBeInTheDocument();
    await pause();
    expect(await screen.findByText('Question 2 of 3')).toBeInTheDocument();
    await pause(CORRECT_ADVANCE_MS * 3);
    expect(rec.answers).toEqual([{ emotion: q.emotion }]);
    expect(rec.nexts()).toBe(1);
    expect(screen.getByText('Question 2 of 3')).toBeInTheDocument();
    const answered = [...api.state.questions.values()].filter((x) => x.chosen !== null);
    expect(answered.map((x) => x.id)).toEqual([q.id]);
  });

  it.each([false, true])(
    'leaving the quiz during the pause cancels the advance (strict: %s)',
    async (strict) => {
      const user = useClock();
      const api = installMockApi({ roundLength: 1 });
      renderRoute(`/players/${ALICE.id}/play`, { strict });
      await screen.findByText(/question 1 of/i);
      const rec = recordRequests();
      await user.click(button(currentQuestion(api).emotion));
      await screen.findByText(/correct!/i);
      await user.click(screen.getByRole('link', { name: 'Home' }));
      expect(await screen.findByRole('heading', { name: "Who's playing?" })).toBeInTheDocument();
      await pause(CORRECT_ADVANCE_MS * 3);
      expect(screen.getByRole('heading', { name: "Who's playing?" })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: /round complete/i })).not.toBeInTheDocument();
      expect(rec.nexts()).toBe(0);
    },
  );

  it('advances exactly once under StrictMode', async () => {
    useClock();
    const api = installMockApi({ roundLength: 3 });
    renderRoute(`/players/${ALICE.id}/play`, { strict: true });
    await screen.findByText(/question 1 of/i);
    const rec = recordRequests();
    fireEvent.keyDown(window, {
      key: String(EMOTIONS.indexOf(currentQuestion(api).emotion) + 1),
    });
    expect(await screen.findByText('Question 2 of 3')).toBeInTheDocument();
    await pause(CORRECT_ADVANCE_MS * 3);
    expect(rec.nexts()).toBe(1);
    expect(screen.getByText('Question 2 of 3')).toBeInTheDocument();
  });

  it('on a miss shows the right emotion and the contrast photo labelled with the guess', async () => {
    const api = await startQuiz();
    const q = currentQuestion(api);
    const wrong = otherThan(q.emotion);
    const user = userEvent.setup();
    await user.click(button(wrong));
    expect(await screen.findByText(new RegExp(`it was ${label(q.emotion)}`))).toBeInTheDocument();
    expect(screen.getByText(`What ${label(wrong)} looks like on this person`)).toBeInTheDocument();
    expect(screen.getByAltText('Same person, for comparison')).toHaveAttribute(
      'src',
      expect.stringMatching(/^\/api\/images\//),
    );
  });

  it('answers with keys 1-7', async () => {
    const api = await startQuiz();
    const q = currentQuestion(api);
    const user = userEvent.setup();
    await user.keyboard(String(EMOTIONS.indexOf(q.emotion) + 1));
    expect(await screen.findByText('Question 2 of 3')).toBeInTheDocument();
    expect(api.state.questions.get(q.id)?.chosen).toBe(q.emotion);
  });

  it('advances with the Next button and updates progress', async () => {
    const api = await startQuiz();
    const user = userEvent.setup();
    const q = currentQuestion(api);
    await user.click(button(otherThan(q.emotion)));
    await user.click(await screen.findByRole('button', { name: /^next$/i }));
    expect(await screen.findByText('Question 2 of 3')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
  });

  it('goes straight to the summary after a correct last answer', async () => {
    const api = await startQuiz(1);
    const user = userEvent.setup();
    await user.click(button(currentQuestion(api).emotion));
    expect(await screen.findByRole('heading', { name: /round complete/i })).toBeInTheDocument();
  });

  it('after a missed last answer waits for See results', async () => {
    const api = await startQuiz(1);
    const user = userEvent.setup();
    await user.click(button(otherThan(currentQuestion(api).emotion)));
    await user.click(await screen.findByRole('button', { name: /see results/i }));
    expect(await screen.findByRole('heading', { name: /round complete/i })).toBeInTheDocument();
  });

  it('resumes the same unanswered question after a reload', async () => {
    const api = await startQuiz();
    const user = userEvent.setup();
    await user.click(button(currentQuestion(api).emotion));
    await screen.findByText('Question 2 of 3');
    const [roundId] = [...api.state.rounds.keys()];
    // A fresh render at the round URL is what a browser reload does.
    document.body.innerHTML = '';
    renderRoute(`/rounds/${roundId}`);
    expect(await screen.findByText('Question 2 of 3')).toBeInTheDocument();
  });

  it('redirects to the summary when a finished round is opened', async () => {
    const api = await startQuiz(1);
    const user = userEvent.setup();
    await user.click(button(currentQuestion(api).emotion));
    await screen.findByRole('heading', { name: /round complete/i });
    const [roundId] = [...api.state.rounds.keys()];
    document.body.innerHTML = '';
    renderRoute(`/rounds/${roundId}`);
    expect(await screen.findByRole('heading', { name: /round complete/i })).toBeInTheDocument();
  });

  it('shows an error and allows a retry when submitting an answer fails', async () => {
    const api = await startQuiz();
    const q = currentQuestion(api);
    server.use(
      http.post('/api/questions/:id/answer', () =>
        HttpResponse.json({ error: 'internal', message: 'Could not save' }, { status: 500 }),
      ),
    );
    const user = userEvent.setup();
    await user.click(button(q.emotion));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save');
    expect(button(q.emotion)).toBeEnabled();
  });

  it('sends one answer when two keys are pressed back to back', async () => {
    const api = await startQuiz();
    const q = currentQuestion(api);
    const bodies: unknown[] = [];
    server.events.on('request:start', async ({ request }) => {
      if (request.url.includes('/answer')) bodies.push(await request.clone().json());
    });
    fireEvent.keyDown(window, { key: '1' });
    fireEvent.keyDown(window, { key: '2' });
    await waitFor(() => expect(api.state.questions.get(q.id)?.chosen).toBe(EMOTIONS[0]));
    server.events.removeAllListeners();
    expect(bodies).toEqual([{ emotion: EMOTIONS[0] }]);
    expect(api.state.questions.get(q.id)?.chosen).toBe(EMOTIONS[0]);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('recovers from a 409 (already answered elsewhere) by moving to the next question', async () => {
    const api = await startQuiz();
    const q = currentQuestion(api);
    api.state.questions.get(q.id)!.chosen = q.emotion; // answered from another tab
    const user = userEvent.setup();
    await user.keyboard('1');
    expect(await screen.findByText('Question 2 of 3')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('capitalises the emotion in the miss banner', async () => {
    const api = await startQuiz();
    const q = currentQuestion(api);
    const user = userEvent.setup();
    await user.click(button(otherThan(q.emotion)));
    expect(await screen.findByText(new RegExp(`it was ${label(q.emotion)}$`))).toBeInTheDocument();
  });
  describe('screen reader announcement', () => {
    /** The persistent aria-live region. Deliberately has no role, so it never joins role=status queries. */
    const live = () => document.querySelector<HTMLElement>('[aria-live="polite"]');

    it('has a polite live region that is empty until an answer is given', async () => {
      await startQuiz();
      expect(live()).not.toBeNull();
      expect(live()).toHaveTextContent('');
    });

    it('announces a correct answer and keeps the region mounted, with its text, through the advance', async () => {
      const user = useClock();
      const api = await startQuiz();
      const region = live();
      // The next question never arrives, so the page sits in its loading state after the advance.
      server.use(http.post('/api/rounds/:id/next', () => delay('infinite')));
      await user.click(button(currentQuestion(api).emotion));
      await waitFor(() => expect(live()).toHaveTextContent('Correct.'));
      await pause();
      expect(screen.queryByText('Question 1 of 3')).not.toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent(/loading question/i);
      expect(live()).toBe(region);
      expect(region).toBeConnected();
      expect(region).toHaveTextContent('Correct.');
    });

    it('announces the right answer on a miss', async () => {
      const api = await startQuiz();
      const q = currentQuestion(api);
      const user = userEvent.setup();
      await user.click(button(otherThan(q.emotion)));
      await waitFor(() =>
        expect(live()).toHaveTextContent(`Incorrect. The answer was ${label(q.emotion)}.`),
      );
    });

    it('clears the previous result on the next question and announces the next one afresh', async () => {
      const api = await startQuiz();
      const user = userEvent.setup();
      await user.click(button(currentQuestion(api).emotion));
      await waitFor(() => expect(live()).toHaveTextContent('Correct.'));
      await screen.findByText('Question 2 of 3');
      // Stale "Correct." must not sit over an unanswered question, and clearing it lets an
      // identical result on this question count as a change the screen reader speaks.
      expect(live()).toHaveTextContent('');
      await user.click(button(currentQuestion(api).emotion));
      await waitFor(() => expect(live()).toHaveTextContent('Correct.'));
    });

    it('clears a miss when the player moves on', async () => {
      const api = await startQuiz();
      const user = userEvent.setup();
      await user.click(button(otherThan(currentQuestion(api).emotion)));
      await waitFor(() => expect(live()).toHaveTextContent(/incorrect/i));
      await user.click(await screen.findByRole('button', { name: /^next$/i }));
      await screen.findByText('Question 2 of 3');
      expect(live()).toHaveTextContent('');
    });
  });
});
