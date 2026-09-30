/**
 * The page's monotonic clock, in milliseconds. It is an object so tests can replace `now`
 * (`vi.spyOn(clock, 'now')`) and control the quiz timer without depending on the wall clock.
 */
export const clock = {
  now: (): number => performance.now(),
};
