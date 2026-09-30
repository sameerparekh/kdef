import { ERROR_CODES, formatZodIssues, notFoundMessage } from '@kdef/shared';
import type { ZodType, z } from 'zod';

/** A domain error that maps to an HTTP status and an ApiError body ({ error, message }). */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const notFound = (what: string) =>
  new HttpError(404, ERROR_CODES.notFound, notFoundMessage(what));
export const conflict = (message: string) => new HttpError(409, ERROR_CODES.conflict, message);

/** Validate an untrusted request value against a shared schema, or throw a 400. */
export function parseOr400<S extends ZodType>(schema: S, value: unknown): z.infer<S> {
  const r = schema.safeParse(value);
  if (!r.success) {
    throw new HttpError(400, ERROR_CODES.badRequest, formatZodIssues(r.error.issues));
  }
  return r.data;
}
