import { ApiError } from '@kdef/shared';
import type { ZodType, z } from 'zod';

/** Thrown for any non-2xx response; carries the server's ApiError body when present. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError | null,
  ) {
    super(body?.message ?? `Request failed with status ${status}`);
    this.name = 'ApiRequestError';
  }
}

/**
 * Fetch JSON and parse it with the shared schema, so a contract drift fails loudly
 * instead of rendering garbage.
 */
export async function request<S extends ZodType>(
  schema: S,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<z.infer<S>> {
  const res = await fetch(path, {
    method: init.method ?? 'GET',
    headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const json: unknown = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const parsed = ApiError.safeParse(json);
    throw new ApiRequestError(res.status, parsed.success ? parsed.data : null);
  }
  return schema.parse(json);
}
