/**
 * The only source of "now" in the server. Inject it; never call Date.now() / new Date()
 * directly (enforced by eslint.config.js). Tests use TestClock.
 */
export interface Clock {
  now(): Date;
}

export const liveClock: Clock = {
  // eslint-disable-next-line no-restricted-syntax -- the one sanctioned wall-clock read
  now: () => new Date(),
};

export class TestClock implements Clock {
  private current: Date;

  constructor(start: Date | string = '2026-01-01T12:00:00.000Z') {
    this.current = new Date(start);
  }

  now(): Date {
    return new Date(this.current.getTime());
  }

  advanceMs(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}
