import { act, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CELEBRATION_MS, CELEBRATIONS } from '../lib/celebration';
import { Celebration } from './Celebration';

afterEach(() => {
  vi.useRealTimers();
});

describe('Celebration', () => {
  it.each([false, true])(
    'holds exactly one timer while playing and none after unmount (strict: %s)',
    (strict) => {
      vi.useFakeTimers();
      const tree = <Celebration kind="confetti" />;
      const { unmount } = render(strict ? <StrictMode>{tree}</StrictMode> : tree);
      expect(vi.getTimerCount()).toBe(1);
      unmount();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('removes itself after CELEBRATION_MS and not before', () => {
    vi.useFakeTimers();
    const { container } = render(<Celebration kind="stars" />);
    expect(container.querySelector('[data-celebration="stars"]')).not.toBeNull();
    act(() => vi.advanceTimersByTime(CELEBRATION_MS - 1));
    expect(container.querySelector('[data-celebration]')).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(container.querySelector('[data-celebration]')).toBeNull();
  });

  it.each(CELEBRATIONS)('draws the %s kind as decorative, non-interactive content', (kind) => {
    const { container } = render(<Celebration kind={kind} />);
    const layer = container.querySelector('[data-celebration]')!;
    expect(layer).toHaveAttribute('aria-hidden', 'true');
    expect(layer.children.length).toBeGreaterThan(0);
    expect(screen.queryByRole('img')).toBeNull();
  });
});
