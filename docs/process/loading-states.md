# Loading states: never render real-looking data before real data has loaded

A pending query shows a spinner or skeleton, **never** a placeholder that looks like a real value: `0`, `0%`, "no answers yet", an empty chart, an empty leaderboard. A loading `0` can't be told apart from a genuine zero, and it hides slow or broken queries.

Every data view handles three states:

- **loading:** spinner or skeleton, marked with `role="status"`.
- **error:** a visible error with the message, not a zero.
- **loaded:** the real value, which may legitimately be 0.

In react-query terms, branch on `isPending` and then `isError` before touching `data`, and never coerce `undefined` to `0`. Each view's tests cover all three states; see `web/src/pages/HomePage.test.tsx` for the pattern.
