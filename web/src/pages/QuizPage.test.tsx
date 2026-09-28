import { EMOTIONS } from '@kdef/shared';
import { screen } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  ALICE,
  currentQuestion,
  label,
  otherThan,
  renderRoute,
  installMockApi,
} from '../test/utils';
import { server } from '../test/server';

async function startQuiz(roundLength = 3) {
  const api = installMockApi({ roundLength });
  renderRoute(`/players/${ALICE.id}/play`);
  await screen.findByText(/question 1 of/i);
  return api;
}

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

  it('marks a correct answer and disables the buttons', async () => {
    const api = await startQuiz();
    const q = currentQuestion(api);
    const user = userEvent.setup();
    await user.click(button(q.emotion));
    expect(await screen.findByText(/correct/i)).toBeInTheDocument();
    expect(screen.queryByText(/looks like on this person/i)).not.toBeInTheDocument();
    expect(button(q.emotion)).toBeDisabled();
    expect(button(otherThan(q.emotion))).toBeDisabled();
  });

  it('on a miss shows the right emotion and the contrast photo labelled with the guess', async () => {
    const api = await startQuiz();
    const q = currentQuestion(api);
    const wrong = otherThan(q.emotion);
    const user = userEvent.setup();
    await user.click(button(wrong));
    expect(await screen.findByText(new RegExp(`it was ${q.emotion}`, 'i'))).toBeInTheDocument();
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
    expect(await screen.findByText(/correct/i)).toBeInTheDocument();
    expect(api.state.questions.get(q.id)?.chosen).toBe(q.emotion);
  });

  it('ignores number keys once answered, and Enter advances to the next question', async () => {
    const api = await startQuiz();
    const q = currentQuestion(api);
    const user = userEvent.setup();
    await user.keyboard(String(EMOTIONS.indexOf(q.emotion) + 1));
    await screen.findByText(/correct/i);
    await user.keyboard('2');
    expect(api.state.questions.get(q.id)?.chosen).toBe(q.emotion);
    await user.keyboard('{Enter}');
    expect(await screen.findByText(/question 2 of 3/i)).toBeInTheDocument();
    expect(button('angry')).toBeEnabled();
  });

  it('advances with the Next button and updates progress', async () => {
    const api = await startQuiz();
    const user = userEvent.setup();
    await user.click(button(currentQuestion(api).emotion));
    await user.click(await screen.findByRole('button', { name: /^next$/i }));
    expect(await screen.findByText('Question 2 of 3')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
  });

  it('goes to the round summary after the last answer', async () => {
    const api = await startQuiz(1);
    const user = userEvent.setup();
    await user.click(button(currentQuestion(api).emotion));
    await user.click(await screen.findByRole('button', { name: /see results/i }));
    expect(await screen.findByRole('heading', { name: /round complete/i })).toBeInTheDocument();
  });

  it('resumes the same unanswered question after a reload', async () => {
    const api = await startQuiz();
    const user = userEvent.setup();
    await user.click(button(currentQuestion(api).emotion));
    await user.click(await screen.findByRole('button', { name: /^next$/i }));
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
    await screen.findByRole('button', { name: /see results/i });
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
});
