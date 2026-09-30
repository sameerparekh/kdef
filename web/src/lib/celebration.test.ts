import { describe, expect, it } from 'vitest';
import { CELEBRATIONS, MESSAGES, pickCelebration } from './celebration';

describe('pickCelebration', () => {
  it('maps the random draws onto a kind and a message', () => {
    expect(pickCelebration(() => 0)).toEqual({ kind: CELEBRATIONS[0], message: MESSAGES[0] });
    expect(pickCelebration(() => 0.999999)).toEqual({
      kind: CELEBRATIONS.at(-1),
      message: MESSAGES.at(-1),
    });
  });

  it('reaches every kind and every message', () => {
    const kinds = new Set<string>();
    const messages = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const p = pickCelebration(() => i / 100);
      kinds.add(p.kind);
      messages.add(p.message);
    }
    expect([...kinds].sort()).toEqual([...CELEBRATIONS].sort());
    expect([...messages].sort()).toEqual([...MESSAGES].sort());
  });

  it('offers at least four kinds and several cheerful messages', () => {
    expect(CELEBRATIONS.length).toBeGreaterThanOrEqual(4);
    expect(MESSAGES.length).toBeGreaterThanOrEqual(3);
  });
});
