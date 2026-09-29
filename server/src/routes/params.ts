import { z } from 'zod';

/** Path params: every resource id is a uuid. A malformed id is a 400 (or 404 for images). */
export const IdParams = z.object({ id: z.string().uuid() });
