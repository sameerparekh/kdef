import { Health } from '@kdef/shared';
import { useQuery } from '@tanstack/react-query';
import { request } from './client';

/** All React Query keys live here so invalidation stays consistent. */
export const qk = {
  health: ['health'] as const,
};

export function useHealth() {
  return useQuery({ queryKey: qk.health, queryFn: () => request(Health, '/api/health') });
}
