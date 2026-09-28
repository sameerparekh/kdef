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

export const notFound = (what: string) => new HttpError(404, 'not_found', `${what} not found`);
export const conflict = (message: string) => new HttpError(409, 'conflict', message);

/** Validate an untrusted request value against a shared schema, or throw a 400. */
export function parseOr400<S extends ZodType>(schema: S, value: unknown): z.infer<S> {
  const r = schema.safeParse(value);
  if (!r.success) {
    const message = r.error.issues.map((i) => `${i.path.join('.') || '(body)'}: ${i.message}`);
    throw new HttpError(400, 'bad_request', message.join('; '));
  }
  return r.data;
}
