/** The `error` codes in an ApiError body. The server sends them; the mock reproduces them. */
export const ERROR_CODES = {
  badRequest: 'bad_request',
  notFound: 'not_found',
  conflict: 'conflict',
} as const;

/** "not_found" message text, e.g. `notFoundMessage('Player')` is "Player not found". */
export const notFoundMessage = (what: string): string => `${what} not found`;

/** The message of a 400: zod issues as "path: message", joined by "; ". */
export function formatZodIssues(
  issues: ReadonlyArray<{ path: ReadonlyArray<string | number>; message: string }>,
): string {
  return issues.map((i) => `${i.path.join('.') || '(body)'}: ${i.message}`).join('; ');
}
