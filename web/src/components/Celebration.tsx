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

// Positions come from the index, not from random numbers, so a render is repeatable.
function Confetti() {
  return (
    <>
      {range(48).map((i) => (
        <span
          key={i}
          className="absolute top-0 block h-3 w-2 animate-confetti rounded-sm"
          style={{
            left: `${(i * 37) % 100}%`,
            backgroundColor: COLORS[i % COLORS.length],
            animationDelay: `${(i % 8) * 90}ms`,
            animationDuration: `${1400 + (i % 5) * 200}ms`,
          }}
        />
      ))}
    </>
  );
}

function Rainbow() {
  return (
    <div className="absolute inset-x-0 top-1/4 h-40 -skew-y-6">
      {RAINBOW.map((color, i) => (
        <div
          key={color}
          className="h-[16.67%] w-full animate-rainbow"
          style={{ backgroundColor: color, animationDelay: `${i * 60}ms` }}
        />
      ))}
    </div>
  );
}

function Unicorn() {
  return (
    <>
      <span className="absolute bottom-24 left-0 animate-unicorn text-8xl">🦄</span>
      {range(8).map((i) => (
        <span
          key={i}
          className="absolute bottom-24 left-0 animate-unicorn text-2xl"
          style={{ animationDelay: `${(i + 1) * 90}ms`, marginTop: `${(i % 3) * 12}px` }}
        >
          ✨
        </span>
      ))}
    </>
  );
}

function Stars() {
  return (
    <>
      {range(14).map((i) => {
        const angle = (Math.PI * (i + 0.5)) / 14; // a fan upward from the bottom middle
        const style = {
          '--dx': `${Math.round(-Math.cos(angle) * (180 + (i % 3) * 90))}px`,
          '--dy': `${Math.round(-Math.sin(angle) * (220 + (i % 4) * 90))}px`,
          animationDelay: `${(i % 4) * 70}ms`,
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
