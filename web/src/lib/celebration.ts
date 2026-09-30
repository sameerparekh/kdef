/** The celebrations a correct answer can trigger. Each one is drawn by components/Celebration.tsx. */
export const CELEBRATIONS = ['confetti', 'rainbow', 'unicorn', 'stars'] as const;
export type CelebrationKind = (typeof CELEBRATIONS)[number];

export const MESSAGES = [
  'Nice!',
  'You got it!',
  'Great eye!',
  'Spot on!',
  'Nailed it!',
  'Yes! Well done!',
] as const;

/**
 * How long the animation layer stays mounted. It never blocks the Next button (it ignores the
 * pointer) and is removed after this, so it cannot cover the photo for long.
 */
export const CELEBRATION_MS = 2500;

/**
 * The web app's one source of randomness. It is an object so tests can replace `next` with a
 * scripted sequence; nothing else in the web app draws random numbers.
 */
export const celebrationRandom = { next: (): number => Math.random() };

export type CelebrationPick = { kind: CelebrationKind; message: (typeof MESSAGES)[number] };

/** Draws a kind, then a message, from `rand` (a function returning a number in [0, 1)). */
export function pickCelebration(rand: () => number = celebrationRandom.next): CelebrationPick {
  return {
    kind: CELEBRATIONS[Math.floor(rand() * CELEBRATIONS.length)]!,
    message: MESSAGES[Math.floor(rand() * MESSAGES.length)]!,
  };
}
