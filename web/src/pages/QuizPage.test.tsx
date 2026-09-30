import { EMOTIONS } from '@kdef/shared';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ALICE,
  currentQuestion,
  label,
  otherThan,
  renderRoute,
  installMockApi,
} from '../test/utils';
import { server } from '../test/server';
import { CELEBRATION_MS, CELEBRATIONS, MESSAGES, celebrationRandom } from '../lib/celebration';

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
const pause = (ms = CELEBRATION_MS) => act(() => vi.advanceTimersByTimeAsync(ms));

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

/** Makes the next celebration this kind with this message (the page draws kind, then message). */
function pinCelebration(kind: (typeof CELEBRATIONS)[number], message: string = MESSAGES[0]) {
  const draws = [
    (CELEBRATIONS.indexOf(kind) + 0.5) / CELEBRATIONS.length,
    ((MESSAGES as readonly string[]).indexOf(message) + 0.5) / MESSAGES.length,
  ];
  let i = 0;
  vi.spyOn(celebrationRandom, 'next').mockImplementation(() => draws[i++ % draws.length]!);
}

/** Stubs the reduced-motion media query, which jsdom does not implement. */
function setReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  }));
}

beforeEach(() => pinCelebration(CELEBRATIONS[0]!));

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const celebration = () => document.querySelector<HTMLElement>('[data-celebration]');
const nextButton = () => screen.findByRole('button', { name: /^next$/i });

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
    expect(await screen.findByRole('alert')).toHaveTextContent(/round not found/i);
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
    expect(await screen.findByRole('alert')).toHaveTextContent(/player not found/i);
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

  it('on a correct answer celebrates, locks the buttons, and waits for Next', async () => {
    const api = await startQuiz();
    const q = currentQuestion(api);
    const user = userEvent.setup();
    await user.click(button(q.emotion));
    expect(await screen.findByText(MESSAGES[0]!)).toBeInTheDocument();
    expect(button(q.emotion)).toBeDisabled();
    expect(button(otherThan(q.emotion))).toBeDisabled();
    expect(screen.queryByText(/looks like on this person/i)).not.toBeInTheDocument();
    expect(await nextButton()).toBeInTheDocument();
    expect(screen.getByText('Question 1 of 3')).toBeInTheDocument();
    await user.click(await nextButton());
    expect(await screen.findByText('Question 2 of 3')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^next$/i })).not.toBeInTheDocument();
    expect(button('angry')).toBeEnabled();
  });

  it('does not advance by itself after a correct answer, however long it waits', async () => {
    const user = useClock();
    const api = await startQuiz();
    const rec = recordRequests();
    await user.click(button(currentQuestion(api).emotion));
    await nextButton();
    await pause(CELEBRATION_MS * 10);
    expect(screen.getByText('Question 1 of 3')).toBeInTheDocument();
    expect(rec.nexts()).toBe(0);
    expect(screen.getByRole('button', { name: /^next$/i })).toBeEnabled();
  });

  it('shows the picked message and the picked celebration kind', async () => {
    pinCelebration('unicorn', 'You got it!');
    const api = await startQuiz();
    const user = userEvent.setup();
    await user.click(button(currentQuestion(api).emotion));
    expect(await screen.findByText('You got it!')).toBeInTheDocument();
    expect(celebration()).toHaveAttribute('data-celebration', 'unicorn');
  });

  it.each(CELEBRATIONS)('can play the %s celebration, hidden from assistive tech', async (kind) => {
    pinCelebration(kind);
    const api = await startQuiz();
    const user = userEvent.setup();
    await user.click(button(currentQuestion(api).emotion));
    await nextButton();
    expect(celebration()).toHaveAttribute('data-celebration', kind);
    expect(celebration()).toHaveAttribute('aria-hidden', 'true');
    expect(celebration()!.className).toContain('pointer-events-none');
    expect(celebration()!.querySelector('img')).toBeNull();
  });

  it('removes the animation after it ends, leaving the message and Next', async () => {
    const user = useClock();
    const api = await startQuiz();
    await user.click(button(currentQuestion(api).emotion));
    await nextButton();
    expect(celebration()).not.toBeNull();
    await pause(CELEBRATION_MS);
    expect(celebration()).toBeNull();
    expect(screen.getByText(MESSAGES[0]!)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^next$/i })).toBeInTheDocument();
  });

  it('with reduced motion shows the message and Next but no animation', async () => {
    setReducedMotion(true);
    const api = await startQuiz();
    const user = userEvent.setup();
    await user.click(button(currentQuestion(api).emotion));
    expect(await screen.findByText(MESSAGES[0]!)).toBeInTheDocument();
    expect(await nextButton()).toBeInTheDocument();
    expect(celebration()).toBeNull();
    expect(document.querySelector('[class*="animate-"]')).toBeNull();
  });

  it('without a reduced-motion preference the animation plays', async () => {
    setReducedMotion(false);
    const api = await startQuiz();
    const user = userEvent.setup();
    await user.click(button(currentQuestion(api).emotion));
    await nextButton();
    expect(celebration()).not.toBeNull();
  });

  it('on a miss waits for the player and does not advance by itself', async () => {
    const user = useClock();
    const api = await startQuiz();
    const q = currentQuestion(api);
    await user.click(button(otherThan(q.emotion)));
    expect(await screen.findByText(/not quite/i)).toBeInTheDocument();
    await pause(CELEBRATION_MS * 10);
    expect(screen.getByText('Question 1 of 3')).toBeInTheDocument();
    expect(screen.getByText(/not quite/i)).toBeInTheDocument();
    expect(celebration()).toBeNull();
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

  it('after a correct answer number keys are ignored and Enter advances exactly once', async () => {
    useClock();
    const api = await startQuiz();
    const q = currentQuestion(api);
    const rec = recordRequests();
    const right = String(EMOTIONS.indexOf(q.emotion) + 1);
    fireEvent.keyDown(window, { key: right });
    await nextButton(); // the answer response is in; the celebration has begun
    fireEvent.keyDown(window, { key: right });
    fireEvent.keyDown(window, { key: '2' });
    await pause(10);
    expect(rec.nexts()).toBe(0); // digits did not advance, and Enter has not been pressed
    expect(screen.getByText('Question 1 of 3')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(await screen.findByText('Question 2 of 3')).toBeInTheDocument();
    await pause(CELEBRATION_MS * 3);
    expect(rec.answers).toEqual([{ emotion: q.emotion }]);
    expect(rec.nexts()).toBe(1);
    expect(screen.getByText('Question 2 of 3')).toBeInTheDocument();
    const answered = [...api.state.questions.values()].filter((x) => x.chosen !== null);
    expect(answered.map((x) => x.id)).toEqual([q.id]);
  });

  it.each([false, true])(
    'leaving the quiz during the celebration goes home and never advances (strict: %s)',
    async (strict) => {
      const user = useClock();
      const api = installMockApi({ roundLength: 1 });
      renderRoute(`/players/${ALICE.id}/play`, { strict });
      await screen.findByText(/question 1 of/i);
      const rec = recordRequests();
      await user.click(button(currentQuestion(api).emotion));
      await screen.findByRole('button', { name: /see results/i });
      expect(celebration()).not.toBeNull();
      await user.click(screen.getByRole('link', { name: 'Home' }));
      expect(await screen.findByRole('heading', { name: "Who's playing?" })).toBeInTheDocument();
      expect(celebration()).toBeNull();
      await pause(CELEBRATION_MS * 3);
      expect(screen.getByRole('heading', { name: "Who's playing?" })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: /round complete/i })).not.toBeInTheDocument();
      expect(rec.nexts()).toBe(0);
    },
  );

  it('advances exactly once under StrictMode when Next is clicked', async () => {
    const api = installMockApi({ roundLength: 3 });
    renderRoute(`/players/${ALICE.id}/play`, { strict: true });
    await screen.findByText(/question 1 of/i);
    const rec = recordRequests();
    const user = userEvent.setup();
    await user.click(button(currentQuestion(api).emotion));
    await user.click(await nextButton());
    expect(await screen.findByText('Question 2 of 3')).toBeInTheDocument();
    await act(() => new Promise((r) => setTimeout(r, 50)));
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
    await nextButton();
    expect(api.state.questions.get(q.id)?.chosen).toBe(q.emotion);
    await user.keyboard('{Enter}');
    expect(await screen.findByText('Question 2 of 3')).toBeInTheDocument();
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

  it('after a correct last answer celebrates and waits for See results', async () => {
    const api = await startQuiz(1);
    const user = userEvent.setup();
    await user.click(button(currentQuestion(api).emotion));
    const seeResults = await screen.findByRole('button', { name: /see results/i });
    expect(screen.queryByRole('heading', { name: /round complete/i })).not.toBeInTheDocument();
    expect(screen.getByText(MESSAGES[0]!)).toBeInTheDocument();
    await user.click(seeResults);
    expect(await screen.findByRole('heading', { name: /round complete/i })).toBeInTheDocument();
  });

  it('after a correct last answer Enter goes to the summary', async () => {
    const api = await startQuiz(1);
    const user = userEvent.setup();
    await user.click(button(currentQuestion(api).emotion));
    await screen.findByRole('button', { name: /see results/i });
    await user.keyboard('{Enter}');
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
    await user.click(await nextButton());
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
    await user.click(await screen.findByRole('button', { name: /see results/i }));
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
      await user.click(await nextButton());
      expect(screen.queryByText('Question 1 of 3')).not.toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent(/loading question/i);
      expect(live()).toBe(region);
      expect(region).toBeInTheDocument();
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
      await user.click(await nextButton());
      await screen.findByText('Question 2 of 3');
      // Stale "Correct." must not sit over an unanswered question, and clearing it lets an
      // identical result on this question count as a change the screen reader speaks.
      expect(live()).toHaveTextContent('');
      await user.click(button(currentQuestion(api).emotion));
      await waitFor(() => expect(live()).toHaveTextContent('Correct.'));
    });

    it('still reads the last correct answer on the summary page', async () => {
      const api = await startQuiz(1);
      const user = userEvent.setup();
      await user.click(button(currentQuestion(api).emotion));
      await user.click(await screen.findByRole('button', { name: /see results/i }));
      expect(await screen.findByRole('heading', { name: /round complete/i })).toBeInTheDocument();
      expect(live()).toHaveTextContent('Correct.');
    });

    it('is the only place the result is announced: the banners carry no status role', async () => {
      const api = await startQuiz();
      const user = userEvent.setup();
      await user.click(button(otherThan(currentQuestion(api).emotion)));
      await screen.findByText(/not quite/i);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('is empty again after leaving the summary for Home', async () => {
      const api = await startQuiz(1);
      const user = userEvent.setup();
      await user.click(button(currentQuestion(api).emotion));
      await user.click(await screen.findByRole('button', { name: /see results/i }));
      await screen.findByRole('heading', { name: /round complete/i });
      expect(live()).toHaveTextContent('Correct.');
      await user.click(screen.getByRole('link', { name: 'Home' }));
      await screen.findByText(/who.s playing/i);
      expect(live()).toHaveTextContent('');
    });

    it('is empty after leaving a missed question unanswered by Next', async () => {
      const user = useClock();
      const api = await startQuiz();
      await user.click(button(otherThan(currentQuestion(api).emotion)));
      await waitFor(() => expect(live()).toHaveTextContent(/incorrect/i));
      await user.click(screen.getByRole('link', { name: 'Home' }));
      await screen.findByText(/who.s playing/i);
      expect(live()).toHaveTextContent('');
    });

    it('is empty after leaving during the celebration', async () => {
      const user = useClock();
      const api = await startQuiz();
      await user.click(button(currentQuestion(api).emotion));
      await waitFor(() => expect(live()).toHaveTextContent('Correct.'));
      await user.click(screen.getByRole('link', { name: 'Home' }));
      await screen.findByText(/who.s playing/i);
      await pause();
      expect(live()).toHaveTextContent('');
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
