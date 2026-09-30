import { useEffect, useState, type CSSProperties } from 'react';
import { CELEBRATION_MS, type CelebrationKind } from '../lib/celebration';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/** True when the player asked the OS for less motion. jsdom has no matchMedia: treat as no. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_MOTION).matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(REDUCED_MOTION);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

const COLORS = ['#f43f5e', '#f59e0b', '#10b981', '#3b82f6', '#a855f7', '#ec4899'];
const RAINBOW = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6'];
const range = (n: number) => Array.from({ length: n }, (_, i) => i);

export type Timing = { delayMs: number; durationMs: number };

/** A share of CELEBRATION_MS, so every timing below scales with the one constant. */
const share = (fraction: number) => Math.round(CELEBRATION_MS * fraction);

const PIECES = { confetti: 48, rainbow: 6, unicorn: 9, stars: 14 } satisfies Record<
  CelebrationKind,
  number
>;

/**
 * Delay and duration of each piece of a kind, in render order. The single place animation timing
 * is decided: every piece ends by its delay plus duration, which stays within CELEBRATION_MS
 * (pinned in Celebration.test.tsx). Applied inline, over the defaults in tailwind.config.js.
 */
export function timingsFor(kind: CelebrationKind): Timing[] {
  return range(PIECES[kind]).map((i) => {
    switch (kind) {
      case 'confetti':
        return { delayMs: share((i % 8) * 0.04), durationMs: share(0.5 + (i % 5) * 0.05) };
      case 'rainbow':
        return { delayMs: share(i * 0.03), durationMs: share(0.8) };
      case 'unicorn': // piece 0 is the unicorn, the rest are its sparkle trail
        return i === 0
          ? { delayMs: 0, durationMs: share(0.8) }
          : { delayMs: share(i * 0.04), durationMs: share(0.6) };
      case 'stars':
        return { delayMs: share((i % 4) * 0.03), durationMs: share(0.55) };
    }
  });
}

const animationStyle = ({ delayMs, durationMs }: Timing): CSSProperties => ({
  animationDelay: `${delayMs}ms`,
  animationDuration: `${durationMs}ms`,
});

// Positions come from the index, not from random numbers, so a render is repeatable.
function Confetti() {
  const timings = timingsFor('confetti');
  return (
    <>
      {timings.map((t, i) => (
        <span
          key={i}
          className="absolute top-0 block h-3 w-2 animate-confetti rounded-sm"
          style={{
            left: `${(i * 37) % 100}%`,
            backgroundColor: COLORS[i % COLORS.length],
            ...animationStyle(t),
          }}
        />
      ))}
    </>
  );
}

function Rainbow() {
  const timings = timingsFor('rainbow');
  return (
    <div className="absolute inset-x-0 top-1/4 h-40 -skew-y-6">
      {RAINBOW.map((color, i) => (
        <div
          key={color}
          className="h-[16.67%] w-full animate-rainbow opacity-70"
          style={{ backgroundColor: color, ...animationStyle(timings[i]!) }}
        />
      ))}
    </div>
  );
}

function Unicorn() {
  const [unicorn, ...trail] = timingsFor('unicorn');
  return (
    <>
      <span
        className="absolute bottom-24 left-0 animate-unicorn text-8xl"
        style={animationStyle(unicorn!)}
      >
        🦄
      </span>
      {trail.map((t, i) => (
        <span
          key={i}
          className="absolute bottom-24 left-0 animate-unicorn text-2xl"
          style={{ marginTop: `${(i % 3) * 12}px`, ...animationStyle(t) }}
        >
          ✨
        </span>
      ))}
    </>
  );
}

function Stars() {
  const timings = timingsFor('stars');
  return (
    <>
      {timings.map((t, i) => {
        const angle = (Math.PI * (i + 0.5)) / timings.length; // a fan upward from the bottom middle
        const style = {
          '--dx': `${Math.round(-Math.cos(angle) * (180 + (i % 3) * 90))}px`,
          '--dy': `${Math.round(-Math.sin(angle) * (220 + (i % 4) * 90))}px`,
          ...animationStyle(t),
        } as CSSProperties;
        return (
          <span
            key={i}
            className="absolute bottom-20 left-1/2 animate-star-pop text-4xl"
            style={style}
          >
            ⭐
          </span>
        );
      })}
    </>
  );
}

const PLAYERS: Record<CelebrationKind, () => JSX.Element> = {
  confetti: Confetti,
  rainbow: Rainbow,
  unicorn: Unicorn,
  stars: Stars,
};

/**
 * A short, purely decorative animation over the page. It is hidden from assistive tech, ignores
 * the pointer (so Next stays clickable), unmounts itself after CELEBRATION_MS and clears its timer
 * if it unmounts sooner. With reduced motion it renders nothing at all.
 */
export function Celebration({ kind }: { kind: CelebrationKind }) {
  const reduced = usePrefersReducedMotion();
  const [playing, setPlaying] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setPlaying(false), CELEBRATION_MS);
    return () => clearTimeout(timer);
  }, []);
  if (reduced || !playing) return null;
  const Player = PLAYERS[kind];
  return (
    <div
      data-celebration={kind}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-10 overflow-hidden"
    >
      <Player />
    </div>
  );
}
