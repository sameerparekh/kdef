import { execFileSync } from 'node:child_process';
import { AnswerResponse, EMOTIONS, Leaderboard, PlayerList } from '@kdef/shared';
import { expect, test, type Page } from '@playwright/test';
import { MESSAGES } from '../web/src/lib/celebration.js';
import { formatAvgPoints, formatPoints, formatPointsEarned } from '../web/src/lib/format.js';

const ROUND_LENGTH = 20;
const PLAYER_NAME = 'Smoke Tester';
/** Any of the cheerful lines a correct answer can show. */
const CELEBRATION_MESSAGE = new RegExp(
  `^(${MESSAGES.map((m) => m.replace(/\W/g, '\\$&')).join('|')})$`,
);
const PROJECT = process.env.E2E_COMPOSE_PROJECT ?? 'kdef-e2e';
/** The same -f files as e2e/run.sh, which exports E2E_COMPOSE_FILES. */
const COMPOSE_FILES = (
  process.env.E2E_COMPOSE_FILES ?? 'docker-compose.yml e2e/docker-compose.e2e.yml'
)
  .split(' ')
  .flatMap((f) => ['-f', f]);
const compose = (...args: string[]) => ['compose', '-p', PROJECT, ...COMPOSE_FILES, ...args];

/** Every alt text on the page must be free of emotion names, or the quiz gives the answer away. */
async function expectNoEmotionInAlt(page: Page) {
  const alts = await page
    .locator('img')
    .evaluateAll((imgs) => imgs.map((i) => (i as HTMLImageElement).alt));
  for (const alt of alts) {
    for (const emotion of EMOTIONS) {
      expect(alt.toLowerCase(), `alt "${alt}" mentions ${emotion}`).not.toContain(emotion);
    }
  }
}

/** Reads the current question's image URL once it has loaded. */
async function currentQuestionSrc(page: Page): Promise<string> {
  const face = page.getByRole('img', { name: 'Face to identify' });
  await expect(face).toBeVisible();
  return (await face.getAttribute('src')) ?? '';
}

test('create a player, play a round, see stats and the leaderboard, survive a restart', async ({
  page,
  request,
}) => {
  // 1. Create a player without choosing a colour: the server picks one with the live RNG.
  let answerRequests = 0;
  page.on('request', (r) => {
    if (/\/api\/questions\/[^/]+\/answer$/.test(r.url())) answerRequests++;
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: "Who's playing?" })).toBeVisible();
  await page.getByLabel('Name').fill(PLAYER_NAME);
  await page.getByRole('button', { name: 'Add player' }).click();
  const tile = page.getByRole('link', { name: PLAYER_NAME, exact: true });
  await expect(tile).toBeVisible();

  const players = PlayerList.parse(await (await request.get('/api/players')).json());
  const created = players.players.find((p) => p.displayName === PLAYER_NAME);
  expect(created?.color).toMatch(/^#[0-9a-f]{6}$/i);

  // 2. Play a full round with the keyboard.
  await tile.click();
  await expect(page.getByText(`Question 1 of ${ROUND_LENGTH}`)).toBeVisible();

  let misses = 0;
  let hits = 0;
  let roundPoints = 0;
  let reloaded = false;
  for (let q = 1; q <= ROUND_LENGTH; q++) {
    await expect(page.getByText(`Question ${q} of ${ROUND_LENGTH}`)).toBeVisible();
    const src = await currentQuestionSrc(page);
    await expectNoEmotionInAlt(page);

    // 4. Reload mid-round: the same unanswered question comes back.
    if (q === 8 && !reloaded) {
      reloaded = true;
      await page.reload();
      await expect(page.getByText(`Question 8 of ${ROUND_LENGTH}`)).toBeVisible();
      expect(await currentQuestionSrc(page)).toBe(src);
    }

    // We cannot know the right answer, so cycle through the keys; some land, some miss.
    // Branch on what the server said, not on what the page happens to show.
    const answered = page.waitForResponse((r) => /\/api\/questions\/[^/]+\/answer$/.test(r.url()));
    await page.keyboard.press(String((q % EMOTIONS.length) + 1));
    const result = AnswerResponse.parse(await (await answered).json());
    roundPoints += result.points;
    // Hits and misses both show the points the server awarded: a hit is at least 1, a miss 0.
    expect(result.points).toBeGreaterThanOrEqual(result.correct ? 1 : 0);
    if (!result.correct) expect(result.points).toBe(0);
    await expect(page.getByText(formatPointsEarned(result.points), { exact: true })).toBeVisible();
    await expect(page.getByText(/^Round total: /)).toHaveText(
      `Round total: ${formatPoints(roundPoints)}`,
    );

    // Both outcomes stop and wait for Next / See results / Enter.
    const wrong = page.getByText(/Not quite/);
    const moved =
      q < ROUND_LENGTH
        ? page.getByText(`Question ${q + 1} of ${ROUND_LENGTH}`)
        : page.getByRole('heading', { name: 'Round complete' });

    const nextLabel = q < ROUND_LENGTH ? 'Next' : 'See results';
    const nextButton = page.getByRole('button', { name: nextLabel });
    if (result.correct) {
      hits++;
      // The celebration message shows and the quiz waits for the player.
      await expect(page.getByText(CELEBRATION_MESSAGE)).toBeVisible();
      await expect(nextButton).toBeVisible();
      await expect(wrong).toHaveCount(0);
      await expect(page.getByRole('img', { name: 'Same person, for comparison' })).toHaveCount(0);
      await expect(page.getByText(`Question ${q} of ${ROUND_LENGTH}`)).toBeVisible();
      // Digit keys are ignored until the player moves on: no second /answer request goes out.
      await page.keyboard.press('1');
      await page.keyboard.press('Enter');
      await expect(moved).toBeVisible();
    } else {
      misses++;
      await expect(wrong).toBeVisible();
      await expect(page.getByRole('img', { name: 'Same person, for comparison' })).toBeVisible();
      await expect(page.getByText(/looks like on this person/)).toBeVisible();
      await expectNoEmotionInAlt(page);
      // Still on this question: a miss does not advance by itself.
      await expect(page.getByText(`Question ${q} of ${ROUND_LENGTH}`)).toBeVisible();
      await expect(nextButton).toBeVisible();
      await page.keyboard.press('Enter');
    }
  }
  expect(hits + misses).toBe(ROUND_LENGTH);
  // One answer per question: keys pressed while the celebration waits sent nothing.
  expect(answerRequests).toBe(ROUND_LENGTH);
  // The shown emotion comes from the live RNG, so a miss is probable, not guaranteed: each press
  // hits with p of about 1/7, so P(no miss in 20) is about 1e-17. The celebration branch is the
  // opposite case: P(no hit in 20) is about 4.6%, so it is checked whenever it occurs but is NOT
  // guaranteed to be covered by any single run.
  expect(misses, 'the contrast image path was never exercised').toBeGreaterThan(0);

  // 3. Summary, then stats with the confusion grid, then the leaderboard.
  await expect(page.getByRole('heading', { name: 'Round complete' })).toBeVisible();
  await expect(page.getByLabel('Score')).toHaveText(`${hits} / ${ROUND_LENGTH}`);
  await expect(page.getByText(/^Total points: /)).toHaveText(`Total points: ${roundPoints}`);

  await page.getByRole('link', { name: 'View stats' }).click();
  await expect(page.getByRole('heading', { name: `${PLAYER_NAME}'s stats` })).toBeVisible();
  await expect(page.getByText(`${hits} correct out of ${ROUND_LENGTH} answers`)).toBeVisible();
  await expect(
    page.getByText(
      `${formatPoints(roundPoints)} in total, ${formatAvgPoints(roundPoints / ROUND_LENGTH)} on average per answer`,
    ),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Confusion matrix' })).toBeVisible();
  await expect(page.getByRole('cell', { name: /^Actual .*, chosen .*: \d+$/ })).toHaveCount(
    EMOTIONS.length * EMOTIONS.length,
  );

  await page.getByRole('link', { name: 'Leaderboard' }).click();
  await expect(page.getByRole('heading', { name: 'Leaderboard' })).toBeVisible();
  const board = Leaderboard.parse(await (await request.get('/api/leaderboard')).json());
  const entry = board.entries.find((e) => e.player.displayName === PLAYER_NAME);
  expect(entry?.windowAnswered).toBe(ROUND_LENGTH);
  expect(entry?.avgPoints).toBeCloseTo(roundPoints / ROUND_LENGTH, 5);
  // One round is below the ranking threshold, so the player must be listed as unranked.
  expect(ROUND_LENGTH).toBeLessThan(board.minAnswers);
  expect(entry?.rank).toBeNull();
  await expect(
    page.getByRole('list', { name: 'Not yet ranked' }).getByText(PLAYER_NAME),
  ).toBeVisible();
  await expect(
    page.getByText(`needs ${board.minAnswers - ROUND_LENGTH} more answers`),
  ).toBeVisible();
  await expectNoEmotionInAlt(page);

  // 5. Restarting the app container skips seeding (the images are already in Postgres).
  execFileSync('docker', compose('restart', 'app'), { stdio: 'inherit' });
  await expect
    .poll(
      async () => {
        try {
          return (await request.get('/api/health')).ok();
        } catch {
          return false;
        }
      },
      { timeout: 60_000 },
    )
    .toBe(true);
  const logs = execFileSync('docker', compose('logs', '--no-color', 'app'), { encoding: 'utf8' });
  expect(logs).toContain('seed: skipped');
});
