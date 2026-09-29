import { execFileSync } from 'node:child_process';
import { EMOTIONS, Leaderboard, PlayerList } from '@kdef/shared';
import { expect, test, type Page } from '@playwright/test';

const ROUND_LENGTH = 20;
const PLAYER_NAME = 'Smoke Tester';
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
    await page.keyboard.press(String((q % EMOTIONS.length) + 1));
    const correct = page.getByRole('status').filter({ hasText: 'Correct!' });
    const wrong = page.getByRole('status').filter({ hasText: 'Not quite' });
    await expect(correct.or(wrong)).toBeVisible();

    if (await wrong.isVisible()) {
      misses++;
      await expect(page.getByRole('img', { name: 'Same person, for comparison' })).toBeVisible();
      await expect(page.getByText(/looks like on this person/)).toBeVisible();
      await expectNoEmotionInAlt(page);
    } else {
      hits++;
      await expect(page.getByRole('img', { name: 'Same person, for comparison' })).toHaveCount(0);
    }

    if (q < ROUND_LENGTH) {
      await page.keyboard.press('Enter');
    } else {
      await expect(page.getByRole('button', { name: 'See results' })).toBeVisible();
      await page.keyboard.press('Enter');
    }
  }
  expect(hits + misses).toBe(ROUND_LENGTH);
  // The shown emotion comes from the live RNG, so a miss is probable, not guaranteed: each press
  // hits with p of about 1/7, so P(no miss in 20) is about 1e-17. The Correct! branch is the
  // opposite case: P(no hit in 20) is about 4.6%, so it is checked whenever it occurs but is NOT
  // guaranteed to be covered by any single run.
  expect(misses, 'the contrast image path was never exercised').toBeGreaterThan(0);

  // 3. Summary, then stats with the confusion grid, then the leaderboard.
  await expect(page.getByRole('heading', { name: 'Round complete' })).toBeVisible();
  await expect(page.getByLabel('Score')).toHaveText(`${hits} / ${ROUND_LENGTH}`);

  await page.getByRole('link', { name: 'View stats' }).click();
  await expect(page.getByRole('heading', { name: `${PLAYER_NAME}'s stats` })).toBeVisible();
  await expect(page.getByText(`${hits} correct out of ${ROUND_LENGTH} answers`)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Confusion matrix' })).toBeVisible();
  await expect(page.getByRole('cell', { name: /^Actual .*, chosen .*: \d+$/ })).toHaveCount(
    EMOTIONS.length * EMOTIONS.length,
  );

  await page.getByRole('link', { name: 'Leaderboard' }).click();
  await expect(page.getByRole('heading', { name: 'Leaderboard' })).toBeVisible();
  const board = Leaderboard.parse(await (await request.get('/api/leaderboard')).json());
  const entry = board.entries.find((e) => e.player.displayName === PLAYER_NAME);
  expect(entry?.windowAnswered).toBe(ROUND_LENGTH);
  if (entry?.rank === null) {
    const needed = board.minAnswers - ROUND_LENGTH;
    await expect(
      page.getByRole('list', { name: 'Not yet ranked' }).getByText(PLAYER_NAME),
    ).toBeVisible();
    await expect(page.getByText(`needs ${needed} more answers`)).toBeVisible();
  } else {
    await expect(
      page.getByRole('table', { name: 'Leaderboard' }).getByText(PLAYER_NAME),
    ).toBeVisible();
  }
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
